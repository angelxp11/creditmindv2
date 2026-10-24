import React, { useEffect, useState } from "react";
import { Check, ClipboardPaste, MapPin, X } from "lucide-react";
import { auth, db } from "../../server/api";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import Loading from "../../resources/loading/loading";
import { showToast } from "../../resources/toastcontainer/ToastContainer";
import { formatObligationDate, formatObligationSchedule, getHomePendingObligations, getLocalDateString } from "../movimientos/obligaciones/obligationUtils";
import { getAccountCardImage, preloadAccountCardImages } from "../../resources/imagenes/tarjetas/accountCard";
import {
  addCreditInstallmentToStatement,
  applyCreditPurchase,
  getCreditInstallmentAmounts,
  getCreditInstallmentSchedule,
  getCreditUsageMetrics,
  getCreditStatementForPurchase,
} from "../cuentas/creditAccountUtils";
import {
  findWalletAccount,
  getShortcutTags,
  getShortcutTagSuggestions,
  parseShortcutMovement,
} from "./shortcutUtils";
import { resolvePlaceName } from "../lugares/lugarUtils";
import "./home.css";

const getObligationMonth = (value) => {
  if (typeof value === "string") return value.slice(0, 7);
  const date = typeof value?.toDate === "function"
    ? value.toDate()
    : value instanceof Date
      ? value
      : null;
  return date && !Number.isNaN(date.getTime())
    ? getLocalDateString(date).slice(0, 7)
    : "";
};

const getObligationDateString = (value) => {
  if (typeof value === "string") return value.slice(0, 10);
  const date = typeof value?.toDate === "function"
    ? value.toDate()
    : value instanceof Date
      ? value
      : null;
  return date && !Number.isNaN(date.getTime()) ? getLocalDateString(date) : "";
};

const normalizeTagValue = (value) => String(value ?? "").trim().toUpperCase();

const normalizeTagList = (list = []) => {
  const source = Array.isArray(list) ? list : [];
  return source
    .map((tag) => normalizeTagValue(tag).replace(/,$/, ""))
    .filter(Boolean);
};

const movementMatchesBudget = (budget, movement) => {
  if (!budget || !movement) {
    return false;
  }

  const budgetTags = normalizeTagList(budget.tags);
  const movementTags = normalizeTagList(movement.tags);
  const budgetNames = [
    budget.categoriaGlobal,
    budget.categoriaNombre,
    budget.establecimiento,
    budget.nombreLegal,
    ...(Array.isArray(budget.tags) ? budget.tags : []),
  ].map((value) => normalizeTagValue(value));
  const movementNames = [
    movement.categoriaGlobal,
    movement.categoriaNombre,
    movement.establecimiento,
    ...(Array.isArray(movement.tags) ? movement.tags : []),
  ].map((value) => normalizeTagValue(value));

  return (
    budgetNames.some((name) => name && movementNames.includes(name)) ||
    budgetTags.some((tag) => movementTags.includes(tag)) ||
    movementTags.some((tag) => budgetTags.includes(tag)) ||
    normalizeTagValue(budget.categoriaGlobal || budget.categoriaNombre) ===
      normalizeTagValue(movement.categoriaGlobal || movement.categoriaNombre)
  );
};

const matchingMovementsForBudget = (budget, accountId, movements = [], categoryCatalog = []) => {
  if (!budget || !Array.isArray(movements)) {
    return 0;
  }

  const startValue = budget.fechaCreacion?.toDate
    ? budget.fechaCreacion.toDate()
    : budget.fechaCreacion || budget.fechaProgramada || budget.fechaFin;
  const start = startValue instanceof Date
    ? startValue
    : new Date(`${String(startValue).slice(0, 10)}T00:00:00`);
  const end = budget.fechaFin
    ? new Date(`${budget.fechaFin}T23:59:59`)
    : start;

  const relatedCategory = categoryCatalog.find((category) => {
    const categoryName = normalizeTagValue(category.categoriaGlobal || category.nombre);
    const budgetName = normalizeTagValue(budget.categoriaGlobal || budget.categoriaNombre || budget.establecimiento);
    const sameCategoryId = budget.categoriaId && category.id === budget.categoriaId;
    return sameCategoryId || categoryName === budgetName;
  });
  const extraTags = normalizeTagList([
    ...(Array.isArray(budget.tags) ? budget.tags : []),
    ...(Array.isArray(relatedCategory?.tags) ? relatedCategory.tags : []),
  ]);

  return movements
    .filter((movement) => movement.cuentaId === accountId && movement.fechaHora)
    .filter((movement) => {
      const movementDate = new Date(
        movement.fechaHora?.seconds ? movement.fechaHora.toDate() : movement.fechaHora
      );
      const movementMatches = movementMatchesBudget(budget, movement, extraTags);

      return movementMatches && movementDate >= start && movementDate <= end;
    })
    .reduce((total, movement) => total + Math.abs(Number(movement.valor || 0)), 0);
};

const Home = () => {
  const user = auth.currentUser;
  const [accounts, setAccounts] = useState([]);
  const [defaultAccount, setDefaultAccount] = useState(null);
  const [savingsAccounts, setSavingsAccounts] = useState([]);
  const [creditAccounts, setCreditAccounts] = useState([]);
  const [budgetedBalance, setBudgetedBalance] = useState(0);
  const [activeBudgetRows, setActiveBudgetRows] = useState([]);
  const [pendingObligations, setPendingObligations] = useState([]);
  const [paidCardObligationsThisMonth, setPaidCardObligationsThisMonth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [readingShortcut, setReadingShortcut] = useState(false);
  const [savingShortcut, setSavingShortcut] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState(null);
  const [suggestedShortcutTags, setSuggestedShortcutTags] = useState([]);
  const [newShortcutTag, setNewShortcutTag] = useState("");
  const [pendingBudgets, setPendingBudgets] = useState([]);
  const [movementHistory, setMovementHistory] = useState([]);
  const [categoryCatalog, setCategoryCatalog] = useState([]);
  const [savedPlaces, setSavedPlaces] = useState([]);
  const totalAhorrado = savingsAccounts.reduce(
    (total, account) => total + (Number(account.saldo) || 0),
    0
  );
  useEffect(() => {
    if (!shortcutDraft) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !savingShortcut) {
        setShortcutDraft(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [shortcutDraft, savingShortcut]);

  useEffect(() => {
    const fetchDefaultAccount = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const [accountsSnapshot, obligationsSnapshot] = await Promise.all([
          getDocs(query(collection(db, "cuentas"), where("usuarioId", "==", user.uid))),
          getDocs(query(collection(db, "obligaciones"), where("usuarioId", "==", user.uid))),
        ]);

        const accountDocs = accountsSnapshot.docs
          .map((accountDoc) => ({ id: accountDoc.id, ...accountDoc.data() }))
          .sort((a, b) => (b.fechaCreacion?.toMillis?.() ?? 0) - (a.fechaCreacion?.toMillis?.() ?? 0));
        preloadAccountCardImages(accountDocs);
        setAccounts(accountDocs);
        const account = accountDocs.find(
          (accountDoc) =>
            accountDoc.esDefault && (accountDoc.tipoCuenta || "gastos") === "gastos"
        ) || accountDocs.find(
          (accountDoc) => (accountDoc.tipoCuenta || "gastos") === "gastos"
        );
        const savings = accountDocs.filter(
          (accountDoc) => accountDoc.tipoCuenta === "ahorros"
        );
        const credit = accountDocs.filter(
          (accountDoc) => accountDoc.tipoCuenta === "credito"
        );
        setDefaultAccount(account || null);
        setSavingsAccounts(savings);
        setCreditAccounts(credit);

        const currentMonth = getLocalDateString().slice(0, 7);
        const allObligations = obligationsSnapshot.docs
          .map((obligationDoc) => ({ id: obligationDoc.id, ...obligationDoc.data() }));
        setPendingObligations(getHomePendingObligations(allObligations));
        setPaidCardObligationsThisMonth(allObligations
          .filter((obligation) => obligation.tipo === "pago_tarjeta" &&
            !obligation.activa &&
            !obligation.anulada &&
            getObligationMonth(obligation.fechaUltimoPago) === currentMonth)
          .sort((a, b) => String(b.fechaUltimoPago).localeCompare(String(a.fechaUltimoPago))));

        if (account) {
          const [budgetsSnapshot, categoriesSnapshot, movementsSnapshot, userSnapshot] = await Promise.all([
            getDocs(query(collection(db, "presupuestos"), where("usuarioId", "==", user.uid))),
            getDocs(query(collection(db, "categorias"), where("usuarioId", "==", user.uid))),
            getDocs(query(collection(db, "movimientos"), where("userId", "==", user.uid))),
            getDoc(doc(db, "usuarios", user.uid)),
          ]);
          const pendingBudgets = budgetsSnapshot.docs
            .map((budgetDoc) => ({ id: budgetDoc.id, ...budgetDoc.data() }))
            .filter(
              (budget) =>
                budget.estado === "pendiente" &&
                budget.cuentaId === account.id &&
                (budget.fechaFin || budget.fechaCreacion)
            );
          setPendingBudgets(pendingBudgets);

          const today = new Date();
          const activeBudgets = pendingBudgets.filter((budget) => {
            const startValue = budget.fechaCreacion?.toDate
              ? budget.fechaCreacion.toDate()
              : budget.fechaCreacion || budget.fechaProgramada || budget.fechaFin;
            const start = startValue instanceof Date
              ? startValue
              : new Date(`${String(startValue).slice(0, 10)}T00:00:00`);
            const end = budget.fechaFin
              ? new Date(`${budget.fechaFin}T23:59:59`)
              : start;
            return today >= start && today <= end;
          });

          const displayBudgets = pendingBudgets.length > 0 ? pendingBudgets : activeBudgets;

          const targetBudge = displayBudgets.reduce(
            (total, budget) => total + Number(budget.valor || 0),
            0
          );

          const categoryList = categoriesSnapshot.docs.map((categoryDoc) => ({
            id: categoryDoc.id,
            ...categoryDoc.data(),
          }));
          setCategoryCatalog(categoryList);
          const places = userSnapshot.data()?.lugares;
          setSavedPlaces(Array.isArray(places) ? places : []);
          const allMovements = movementsSnapshot.docs.map((movementDoc) => movementDoc.data());
          setMovementHistory(allMovements);
          const matchingMovements = allMovements
            .filter((movement) => movement.cuentaId === account.id);

          const activeBudgetRowsData = displayBudgets.map((budget) => {
            const spent = matchingMovementsForBudget(budget, account.id, matchingMovements, categoryList);

            return {
              id: budget.id,
              name: budget.categoriaGlobal || budget.categoriaNombre || budget.establecimiento || "Presupuesto",
              target: Number(budget.valor || 0),
              spent,
              remaining: Number(budget.valor || 0) - spent,
            };
          });
          setBudgetedBalance(targetBudge);
          setActiveBudgetRows(activeBudgetRowsData);
        } else {
          setBudgetedBalance(0);
          setActiveBudgetRows([]);
        }
      } catch (error) {
        console.error("Error cargando la cuenta predeterminada:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDefaultAccount();
  }, [user]);

  const currentBalance = Number(defaultAccount?.saldo || 0);
  const availableBalance = currentBalance - budgetedBalance;
  const formatMoney = (value) => Number(value || 0).toLocaleString("es-CO");
  const shortcutInstallmentTotal = Number(shortcutDraft?.valor || 0);
  const shortcutInstallmentCount = Number(shortcutDraft?.cuotas ?? 1);
  const shortcutInstallmentAmounts = shortcutDraft &&
    Number.isSafeInteger(shortcutInstallmentTotal) &&
    shortcutInstallmentTotal > 0 &&
    Number.isSafeInteger(shortcutInstallmentCount) &&
    shortcutInstallmentCount > 1 &&
    shortcutInstallmentCount <= shortcutInstallmentTotal &&
    shortcutInstallmentCount <= 60
    ? getCreditInstallmentAmounts(shortcutInstallmentTotal, shortcutInstallmentCount)
    : [];
  const shortcutMonthlyInstallment = shortcutInstallmentAmounts[0] || 0;
  const totalPendingObligations = pendingObligations.reduce(
    (total, obligation) => total + (obligation.tipo === "pago_deuda" && obligation.deudaId
      ? 0
      : (
      Number(
        obligation.tipo === "pago_tarjeta"
          ? obligation.montoPendiente ?? obligation.valor
          : obligation.valor
      ) || 0
    )),
    0
  );

  const handlePasteShortcut = async () => {
    if (!navigator.clipboard?.readText) {
      showToast("Este navegador no permite leer el portapapeles", "error");
      return;
    }

    try {
      const clipboardRead = navigator.clipboard.readText();
      setReadingShortcut(true);
      const clipboardText = await clipboardRead;
      const shortcutMovement = parseShortcutMovement(clipboardText);
      const matchedAccount = findWalletAccount(accounts, shortcutMovement.tarjeta);
      const recognizedEstablishment =
        resolvePlaceName(
          shortcutMovement.establecimiento,
          savedPlaces,
          shortcutMovement.ubicacion
        ) || shortcutMovement.establecimiento;
      const matchingTags = getShortcutTagSuggestions(
        movementHistory,
        shortcutMovement.establecimiento,
        shortcutMovement.valor,
        [recognizedEstablishment],
        savedPlaces,
        shortcutMovement.ubicacion
      );
      setSuggestedShortcutTags(matchingTags);
      setShortcutDraft({
        ...shortcutMovement,
        nombreEstablecimiento: recognizedEstablishment,
        cuentaId: matchedAccount?.id || "",
        walletAccountMatched: Boolean(matchedAccount),
        tags: [],
        cuotas: 1,
      });
      setNewShortcutTag("");
    } catch (error) {
      console.error("Error leyendo el movimiento del atajo:", error);
      showToast(error.message || "No se pudo leer el movimiento del atajo", "error");
    } finally {
      setReadingShortcut(false);
    }
  };

  const addShortcutTag = () => {
    const tag = normalizeTagValue(newShortcutTag).replace(/,$/, "");
    if (tag) {
      setShortcutDraft((current) => current
        ? {
          ...current,
          tags: current.tags?.includes(tag)
            ? current.tags
            : [...(current.tags || []), tag],
        }
        : current);
      setNewShortcutTag("");
    }
  };

  const handleShortcutTagKeyDown = (event) => {
    if ([" ", ",", "Enter"].includes(event.key) && newShortcutTag.trim()) {
      event.preventDefault();
      addShortcutTag();
    } else if (event.key === "Backspace" && !newShortcutTag && shortcutDraft?.tags?.length) {
      setShortcutDraft((current) => current
        ? { ...current, tags: current.tags.slice(0, -1) }
        : current);
    }
  };

  const handleConfirmShortcut = async () => {
    if (!user) {
      showToast("Necesitas iniciar sesión", "error");
      return;
    }
    const account = accounts.find((item) => item.id === shortcutDraft?.cuentaId);
    if (!account) {
      showToast("Selecciona el método de pago correcto", "error");
      return;
    }
    if (!["gastos", "credito"].includes(account.tipoCuenta || "gastos")) {
      showToast("Las cuentas de ahorros no se pueden usar para pagos", "error");
      return;
    }

    const legalName = String(shortcutDraft.establecimiento || "").trim().toUpperCase();
    const displayName = String(shortcutDraft.nombreEstablecimiento || "").trim().toUpperCase();
    const amount = Number(shortcutDraft.valor);
    const movementDate = new Date(shortcutDraft.fechaHora);
    const tags = getShortcutTags(shortcutDraft.tags, newShortcutTag);
    const installments = Number(shortcutDraft.cuotas ?? 1);
    if (!legalName || !displayName || !Number.isSafeInteger(amount) || amount <= 0 ||
      Number.isNaN(movementDate.getTime()) || movementDate > new Date() ||
      (account.tipoCuenta === "credito" &&
      (!Number.isSafeInteger(installments) || installments < 1 || installments > 60 || installments > amount))) {
      showToast("Revisa el establecimiento, el importe y la fecha del movimiento", "error");
      return;
    }

    const isCreditAccount = account.tipoCuenta === "credito";
    const reservedAmount = pendingBudgets
      .filter((budget) => budget.cuentaId === account.id)
      .reduce((total, budget) => total + Number(budget.valor || 0), 0);
    if (!isCreditAccount && amount > Number(account.saldo || 0) - reservedAmount) {
      showToast("Saldo disponible insuficiente: hay dinero reservado en presupuestos", "error");
      return;
    }

    setSavingShortcut(true);
    const accountRef = doc(db, "cuentas", account.id);
    const movementRef = doc(collection(db, "movimientos"));
    try {
      const saved = await runTransaction(db, async (transaction) => {
        const accountSnapshot = await transaction.get(accountRef);
        if (!accountSnapshot.exists()) throw new Error("ACCOUNT_UNAVAILABLE");
        const currentAccount = accountSnapshot.data();
        if (currentAccount.usuarioId !== user.uid) throw new Error("ACCOUNT_UNAVAILABLE");
        if (!["gastos", "credito"].includes(currentAccount.tipoCuenta || "gastos")) {
          throw new Error("ACCOUNT_INVALID_TYPE");
        }

        const movement = {
          userId: user.uid,
          usuarioId: user.uid,
          cuentaId: account.id,
          cuentaBanco: currentAccount.banco || "",
          cuentaNombre: currentAccount.nombre || "",
          valor: amount,
          establecimiento: legalName,
          nombreLegal: legalName,
          nombreEstablecimiento: displayName,
          tags,
          ubicacion: shortcutDraft.ubicacion,
          fechaHora: movementDate,
          fechaCreacion: serverTimestamp(),
        };

        if (currentAccount.tipoCuenta === "credito") {
          const creditChanges = applyCreditPurchase(currentAccount, amount);
          const schedule = getCreditInstallmentSchedule(
            currentAccount,
            amount,
            installments,
            movementDate
          );
          if (!schedule) throw new Error("CREDIT_STATEMENT_DATES_UNAVAILABLE");
          const firstInstallment = schedule[0];
          if (installments === 1) {
            const statementDates = getCreditStatementForPurchase(currentAccount, movementDate);
            if (!statementDates) throw new Error("CREDIT_STATEMENT_DATES_UNAVAILABLE");
            const startDate = getLocalDateString(statementDates.startDate);
            const cutoffDate = getLocalDateString(statementDates.cutoffDate);
            const paymentDate = getLocalDateString(statementDates.paymentDate);
            const obligationId = `tarjeta-${account.id}-${cutoffDate}`;
            const obligationRef = doc(db, "obligaciones", obligationId);
            const obligationSnapshot = await transaction.get(obligationRef);
            const previousObligation = obligationSnapshot.exists()
              ? obligationSnapshot.data()
              : null;
            if (previousObligation && (
              previousObligation.usuarioId !== user.uid ||
              previousObligation.tarjetaId !== account.id
            )) {
              throw new Error("CREDIT_OBLIGATION_CONFLICT");
            }
            const statementTotal = Number(previousObligation?.valor || 0) + amount;
            const statementRemaining =
              Number(previousObligation?.montoPendiente ?? previousObligation?.valor ?? 0) + amount;
            const obligation = {
              usuarioId: user.uid,
              tipo: "pago_tarjeta",
              nombre: `PAGO TARJETA ${currentAccount.nombre || currentAccount.banco || ""}`.trim(),
              tarjetaId: account.id,
              tarjetaNombre: currentAccount.nombre || "",
              tarjetaBanco: currentAccount.banco || "",
              cuentaNombre: `${currentAccount.banco || ""} · ${currentAccount.nombre || ""}`.trim(),
              fechaInicioCiclo: startDate,
              fechaCorte: cutoffDate,
              fechaProximoPago: paymentDate,
              diaVencimiento: Number(paymentDate.slice(-2)),
              frecuencia: "mensual",
              valor: statementTotal,
              montoPendiente: statementRemaining,
              activa: statementRemaining > 0,
              anulada: false,
              ...(previousObligation?.fechaCreacion ? {} : { fechaCreacion: serverTimestamp() }),
              ultimaActualizacion: serverTimestamp(),
            };

            transaction.update(accountRef, {
              ...creditChanges,
              ultimaActualizacion: serverTimestamp(),
            });
            transaction.set(obligationRef, obligation);
            transaction.set(movementRef, {
              ...movement,
              tipo: "credito_compra",
              origen: "tarjeta_credito",
              cuotas: 1,
              obligacionId: obligationId,
              fechaCorteTarjeta: cutoffDate,
              fechaLimitePagoTarjeta: paymentDate,
            });
            return {
              accountId: account.id,
              saldo: creditChanges.saldo,
              deudaActual: creditChanges.deudaActual,
              obligation: { ...obligation, id: obligationId },
              installmentAmount: firstInstallment.amount,
            };
          }

          const debtId = movementRef.id;
          const obligationId = `deuda-tarjeta-${movementRef.id}`;
          const debtRef = doc(db, "deudas", debtId);
          const obligationRef = doc(db, "obligaciones", obligationId);
          const firstDueDate = getLocalDateString(firstInstallment.paymentDate);
          const installmentStatements = schedule.map((installment) => {
            const startDate = getLocalDateString(installment.startDate);
            const cutoffDate = getLocalDateString(installment.cutoffDate);
            const paymentDate = getLocalDateString(installment.paymentDate);
            const statementId = `tarjeta-${account.id}-${cutoffDate}`;
            return {
              installment,
              startDate,
              cutoffDate,
              paymentDate,
              ref: doc(db, "obligaciones", statementId),
            };
          });
          const installmentStatementSnapshots = await Promise.all(
            installmentStatements.map(({ ref }) => transaction.get(ref))
          );
          installmentStatements.forEach((statement, index) => {
            const snapshot = installmentStatementSnapshots[index];
            const previousStatement = snapshot.exists() ? snapshot.data() : null;
            if (previousStatement && (
              previousStatement.usuarioId !== user.uid ||
              previousStatement.tarjetaId !== account.id ||
              previousStatement.tipo !== "pago_tarjeta"
            )) {
              throw new Error("CREDIT_OBLIGATION_CONFLICT");
            }
            const statementTotals = addCreditInstallmentToStatement(
              previousStatement,
              statement.installment.amount,
              {
                deudaId: debtId,
                obligacionId: obligationId,
                numero: statement.installment.installment,
                valor: statement.installment.amount,
                pagada: false,
              }
            );
            transaction.set(statement.ref, {
              usuarioId: user.uid,
              tipo: "pago_tarjeta",
              nombre: `PAGO TARJETA ${currentAccount.nombre || currentAccount.banco || ""}`.trim(),
              tarjetaId: account.id,
              tarjetaNombre: currentAccount.nombre || "",
              tarjetaBanco: currentAccount.banco || "",
              cuentaNombre: `${currentAccount.banco || ""} · ${currentAccount.nombre || ""}`.trim(),
              fechaInicioCiclo: statement.startDate,
              fechaCorte: statement.cutoffDate,
              fechaProximoPago: statement.paymentDate,
              diaVencimiento: Number(statement.paymentDate.slice(-2)),
              frecuencia: "mensual",
              ...statementTotals,
              ...(previousStatement?.fechaCreacion ? {} : { fechaCreacion: serverTimestamp() }),
              ultimaActualizacion: serverTimestamp(),
            });
          });
          const debt = {
            usuarioId: user.uid,
            nombre: displayName,
            monto: amount,
            montoRestante: amount,
            fechaAdquisicion: movementDate,
            proximaFechaPago: firstDueDate,
            tieneInteres: false,
            pagada: false,
            cuotas: installments,
            valorCuota: firstInstallment.amount,
            valoresCuota: schedule.map(({ amount: installmentAmount }) => installmentAmount),
            tags,
            cuentaId: account.id,
            tarjetaId: account.id,
            movimientoId: movementRef.id,
            obligacionId: obligationId,
            origen: "compra_tarjeta",
            fechaCreacion: serverTimestamp(),
            ultimaActualizacion: serverTimestamp(),
          };
          const obligation = {
            usuarioId: user.uid,
            tipo: "pago_deuda",
            nombre: displayName,
            valor: firstInstallment.amount,
            cuentaId: account.id,
            cuentaBanco: currentAccount.banco || "",
            cuentaNombre: currentAccount.nombre || "",
            frecuencia: "mensual",
            fechaProximoPago: firstDueDate,
            diaVencimiento: Number(firstDueDate.slice(-2)),
            proximoPagoNumero: 1,
            deudaId: debtId,
            deudaRestante: amount,
            deudaPagada: false,
            cuotas: installments,
            valoresCuota: schedule.map(({ amount: installmentAmount }) => installmentAmount),
            activa: true,
            fechaCreacion: serverTimestamp(),
          };

          transaction.update(accountRef, {
            ...creditChanges,
            ultimaActualizacion: serverTimestamp(),
          });
          transaction.set(debtRef, debt);
          transaction.set(obligationRef, obligation);
          transaction.set(movementRef, {
            ...movement,
            cuentaBanco: currentAccount.banco || "",
            cuentaNombre: currentAccount.nombre || "",
            tipo: "credito_compra",
            origen: "tarjeta_credito",
            cuotas: installments,
            valorCuota: firstInstallment.amount,
            deudaId: debtId,
            obligacionId: obligationId,
            fechaLimitePagoTarjeta: firstDueDate,
          });
          return {
            accountId: account.id,
            saldo: creditChanges.saldo,
            deudaActual: creditChanges.deudaActual,
            debtId,
            obligation: { ...obligation, id: obligationId },
            installmentAmount: firstInstallment.amount,
          };
        }

        const currentBalance = Number(currentAccount.saldo || 0);
        if (!Number.isFinite(currentBalance) || currentBalance < amount) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        const nextBalance = currentBalance - amount;
        transaction.update(accountRef, {
          saldo: nextBalance,
          ultimaActualizacion: serverTimestamp(),
        });
        transaction.set(movementRef, movement);
        return { accountId: account.id, saldo: nextBalance };
      });

      setAccounts((current) => current.map((item) =>
        item.id === saved.accountId
          ? { ...item, saldo: saved.saldo, ...(saved.deudaActual !== undefined ? { deudaActual: saved.deudaActual } : {}) }
          : item
      ));
      if (saved.deudaActual !== undefined) {
        setCreditAccounts((current) => current.map((item) =>
          item.id === saved.accountId
            ? { ...item, saldo: saved.saldo, deudaActual: saved.deudaActual }
            : item
        ));
      }
      if (defaultAccount?.id === saved.accountId) {
        setDefaultAccount((current) => current ? { ...current, saldo: saved.saldo } : current);
      }
      if (isCreditAccount && installments > 1 && !saved.debtId) {
        throw new Error("CREDIT_DEBT_NOT_CREATED");
      }
      const savedMovement = {
        cuentaId: saved.accountId,
        valor: amount,
        establecimiento: legalName,
        nombreLegal: legalName,
        nombreEstablecimiento: displayName,
        tags,
        ubicacion: shortcutDraft.ubicacion,
        fechaHora: movementDate,
        ...(isCreditAccount ? { tipo: "credito_compra", cuotas: installments } : {}),
      };
      const updatedMovementHistory = [savedMovement, ...movementHistory];
      setMovementHistory(updatedMovementHistory);
      const updatedBudgetRows = activeBudgetRows.map((row) => {
        const budget = pendingBudgets.find((item) => item.id === row.id);
        if (!budget) return row;
        const spent = matchingMovementsForBudget(
          budget,
          budget.cuentaId,
          updatedMovementHistory,
          categoryCatalog
        );
        return { ...row, spent, remaining: Number(budget.valor || 0) - spent };
      });
      setActiveBudgetRows(updatedBudgetRows);
      if (saved.obligation) {
        setPendingObligations((current) => {
        return [
          ...current.filter((obligation) => obligation.id !== saved.obligation.id),
          saved.obligation,
        ].sort((first, second) =>
          String(first.fechaProximoPago).localeCompare(String(second.fechaProximoPago))
        );
        });
      }
      showToast(isCreditAccount && installments > 1
        ? `Compra registrada como deuda: ${installments} cuotas mensuales de $${formatMoney(saved.installmentAmount)}`
        : "Movimiento registrado correctamente", "success");
      setShortcutDraft(null);
      setNewShortcutTag("");
    } catch (error) {
      console.error("Error confirmando movimiento del atajo:", error);
      const messages = {
        ACCOUNT_UNAVAILABLE: "La cuenta seleccionada ya no está disponible",
        ACCOUNT_INVALID_TYPE: "Las cuentas de ahorros no se pueden usar para pagos",
        INSUFFICIENT_BALANCE: "El saldo de la cuenta ya no es suficiente",
        CREDIT_LIMIT_EXCEEDED: "La compra supera el cupo disponible de la tarjeta",
        CREDIT_USAGE_LIMIT_EXCEEDED: "La compra supera el límite de uso configurado para la tarjeta",
        CREDIT_STATEMENT_DATES_UNAVAILABLE: "Configura las fechas de corte y pago de la tarjeta",
        CREDIT_OBLIGATION_CONFLICT: "No se pudo asociar la compra al extracto de esta tarjeta",
        CREDIT_DEBT_NOT_CREATED: "No se confirmó la creación de la deuda de la compra",
      };
      showToast(
        error.code === "permission-denied"
          ? "Firebase denegó el registro; publica las reglas actualizadas de Firestore"
          : messages[error.message] || "No se pudo registrar el movimiento",
        "error"
      );
    } finally {
      setSavingShortcut(false);
    }
  };

  const categoryPalette = [
    "home-budget-summary__dot--1",
    "home-budget-summary__dot--2",
    "home-budget-summary__dot--3",
    "home-budget-summary__dot--4",
    "home-budget-summary__dot--5",
  ];
  const frequentCreditAccounts = creditAccounts
    .map((account) => ({
      account,
      usageCount: movementHistory.filter((movement) =>
        movement.cuentaId === account.id &&
        (movement.tipo === "credito_compra" || movement.tipo === "credito_avance")
      ).length,
    }))
    .sort((first, second) => second.usageCount - first.usageCount);

  return (
    <div className="home-container">
      {loading && <Loading message="Cargando tu saldo..." />}
      {readingShortcut && <Loading message="Leyendo el movimiento del atajo..." />}
      <section className="home-main-account">
        <span className="home-balance__account">
          {defaultAccount
            ? `${defaultAccount.banco} · ${defaultAccount.nombre}`
            : "Cuenta principal"}
        </span>

        {defaultAccount ? (
          <>
          <div className="home-available" aria-live="polite">
            <div>
              <span className="home-available__label">Saldo libre en tu cuenta</span>
              <span className="home-available__hint">
                Saldo actual ${formatMoney(currentBalance)} · Apartado en presupuestos ${formatMoney(budgetedBalance)}
              </span>
            </div>
            <strong className={availableBalance < 0 ? "home-available__value home-available__value--negative" : "home-available__value"}>
              ${formatMoney(availableBalance)}
            </strong>
          </div>

          {activeBudgetRows.length > 0 && (
            <div className="home-budget-summary">
              <div className="home-budget-summary__header">
                <strong>Gasto de tus presupuestos</strong>
                <span>Lo gastado frente al límite asignado</span>
              </div>
              <div className="home-budget-summary__list">
                {activeBudgetRows.map((row, index) => (
                  <div key={row.id} className="home-budget-summary__item">
                    <span className={`home-budget-summary__dot ${categoryPalette[index % categoryPalette.length]}`} />
                    <div className="home-budget-summary__meta">
                      <strong>{row.name}</strong>
                      <span>Gastado ${formatMoney(row.spent)} de ${formatMoney(row.target)}</span>
                      <div
                        className="home-budget-summary__track"
                        role="progressbar"
                        aria-label={`Gastado del presupuesto ${row.name}`}
                        aria-valuemin="0"
                        aria-valuemax={Math.max(0, Number(row.target) || 0)}
                        aria-valuenow={Math.min(Math.max(0, Number(row.spent) || 0), Math.max(0, Number(row.target) || 0))}
                      >
                        <span
                          className={row.remaining < 0 ? "home-budget-summary__fill home-budget-summary__fill--over" : "home-budget-summary__fill"}
                          style={{ width: `${row.target > 0 ? Math.min(100, Math.max(0, (row.spent / row.target) * 100)) : 0}%` }}
                        />
                      </div>
                    </div>
                    <span className="home-budget-summary__remaining-wrap">
                      <strong className={row.remaining < 0 ? "home-budget-summary__remaining home-budget-summary__remaining--negative" : "home-budget-summary__remaining"}>
                        ${formatMoney(Math.abs(row.remaining))}
                      </strong>
                      <span>{row.remaining < 0 ? "Excedido" : "Restante"}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {frequentCreditAccounts.length > 0 && (
            <div className="home-credit-quickview">
              <div className="home-credit-quickview__heading">
                <strong>Uso de tus tarjetas</strong>
                <span>Ordenadas por frecuencia de uso</span>
              </div>
              <div className="home-credit-quickview__list">
                {frequentCreditAccounts.map(({ account, usageCount }) => {
                  const limit = Math.max(0, Number(account.limiteCredito) || 0);
                  const debt = Math.max(0, Number(account.deudaActual) || 0);
                  const usageMetrics = getCreditUsageMetrics(account);
                  const spentWidth = limit > 0 ? Math.min(100, debt / limit * 100) : 0;
                  const spendableAmount = Math.min(
                    usageMetrics.remainingToSpend,
                    Math.max(0, limit - debt)
                  );
                  const spendableWidth = limit > 0
                    ? Math.min(100 - spentWidth, spendableAmount / limit * 100)
                    : 0;
                  const reservedAmount = limit > 0
                    ? Math.max(0, limit - Math.min(debt, limit) - spendableAmount)
                    : 0;
                  const reservedWidth = limit > 0 ? reservedAmount / limit * 100 : 0;

                  return (
                    <article className="home-credit-quickview__item" key={account.id}>
                      <img
                        src={getAccountCardImage(account)}
                        alt=""
                        loading="lazy"
                      />
                      <div className="home-credit-quickview__details">
                        <div className="home-credit-quickview__name">
                          <strong>{account.nombre}</strong>
                          <span>{account.banco} · {usageCount} {usageCount === 1 ? "uso" : "usos"}</span>
                        </div>
                        <div
                          className="home-credit__track"
                          role="progressbar"
                          aria-label={`Uso del cupo de ${account.nombre}`}
                          aria-valuemin="0"
                          aria-valuemax="100"
                          aria-valuenow={Math.round(spentWidth)}
                          aria-valuetext={`Gastado: $${formatMoney(debt)}. Puedes gastar: $${formatMoney(spendableAmount)}. No puedes gastar: $${formatMoney(reservedAmount)}.`}
                        >
                          <span className="home-credit__track-spent" style={{ width: `${spentWidth}%` }} />
                          <span className="home-credit__track-spendable" style={{ width: `${spendableWidth}%` }} />
                          <span className="home-credit__track-reserved" style={{ width: `${reservedWidth}%` }} />
                        </div>
                        <div className="home-credit-quickview__amounts">
                          <span>Gastado <strong>${formatMoney(debt)}</strong></span>
                          <span>Puedes gastar <strong>${formatMoney(spendableAmount)}</strong></span>
                          <span>No disponible <strong>${formatMoney(reservedAmount)}</strong></span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </>
        ) : (
          <p className="home-empty">
            Aún no tienes una cuenta principal configurada.
          </p>
        )}
      </section>

      <section className="home-obligations" aria-labelledby="home-obligations-title">
        <div className="home-obligations__heading">
          <div>
            <span className="home-savings__eyebrow">Pagos recurrentes</span>
            <h2 id="home-obligations-title">Obligaciones por pagar</h2>
            <p className="home-obligations__description">
              Incluye pagos del mes y extractos pendientes de tus tarjetas de crédito.
            </p>
          </div>
          <span className="home-obligations__count">{pendingObligations.length}</span>
        </div>
        <div className="home-obligations__total">
          <span>Total pendiente este mes</span>
          <strong>${formatMoney(totalPendingObligations)}</strong>
        </div>
        {pendingObligations.length === 0 ? (
          <p className="home-empty">No tienes obligaciones pendientes para este mes.</p>
        ) : (
          <div className="home-obligations__list">
            {pendingObligations.map((obligation) => (
              <article className="home-obligation" key={obligation.id}>
                <div className="home-obligation__details">
                  <strong>{obligation.nombre}</strong>
                  <span>
                    {obligation.tipo === "pago_tarjeta"
                      ? obligation.fechaInicioCiclo
                        ? `Ciclo de corte: ${formatObligationDate(obligation.fechaInicioCiclo)} – ${formatObligationDate(obligation.fechaCorte)}`
                        : `Extracto con corte ${formatObligationDate(obligation.fechaCorte)}`
                      : formatObligationSchedule(obligation)}
                    {" · "}{String(obligation.fechaProximoPago).slice(0, 10) < getLocalDateString() ? "Venció" : "Vence"} {formatObligationDate(obligation.fechaProximoPago)}
                    {" · "}{obligation.tipo === "pago_tarjeta"
                      ? `${obligation.tarjetaBanco || ""} ${obligation.tarjetaNombre || ""}`.trim()
                      : obligation.cuentaNombre}
                    {obligation.deudaId && obligation.cuotas
                      ? ` · Cuota ${obligation.proximoPagoNumero || 1} de ${obligation.cuotas}`
                      : ""}
                    {obligation.deudaId && obligation.cuotas
                      ? " · Esta cuota ya está incluida en el extracto de la tarjeta"
                      : ""}
                  </span>
                </div>
                {obligation.tipo === "pago_tarjeta" ? (
                  <div className="home-obligation__totals">
                    <strong className="home-obligation__amount">
                      Total acumulado: ${Number(obligation.valor || 0).toLocaleString("es-CO")}
                    </strong>
                    <span className="home-obligation__remaining">
                      Pendiente: ${Number(obligation.montoPendiente ?? obligation.valor ?? 0).toLocaleString("es-CO")}
                    </span>
                  </div>
                ) : (
                  <div className="home-obligation__totals">
                    <strong className="home-obligation__amount">
                      Cuota: ${Number(obligation.valor || 0).toLocaleString("es-CO")}
                    </strong>
                    {obligation.deudaId && obligation.cuotas && (
                      <span className="home-obligation__remaining">
                        Incluida en el extracto de la tarjeta
                      </span>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {paidCardObligationsThisMonth.length > 0 && (
          <div className="home-obligations__paid">
            <h3>Extractos de tarjeta pagados este mes</h3>
            <div className="home-obligations__list">
              {paidCardObligationsThisMonth.map((obligation) => (
                <article className="home-obligation home-obligation--paid" key={obligation.id}>
                  <div className="home-obligation__details">
                    <strong>{obligation.nombre}</strong>
                    <span>
                      Corte {formatObligationDate(obligation.fechaCorte)}
                      {" · "}{obligation.tarjetaBanco || ""} {obligation.tarjetaNombre || ""}
                      {" · Pagado "}{formatObligationDate(getObligationDateString(obligation.fechaUltimoPago))}
                    </span>
                  </div>
                  <strong className="home-obligation__paid-status">Pagada</strong>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="home-savings" aria-labelledby="home-savings-title">
        <div className="home-savings__heading">
          <div>
            <span className="home-savings__eyebrow">Ahorro</span>
            <h2 id="home-savings-title">Mis alcancías</h2>
          </div>
          <div className="home-savings__summary">
            <strong>${formatMoney(totalAhorrado)}</strong>
            <span>Total ahorrado</span>
          </div>
        </div>
        {savingsAccounts.length === 0 ? (
          <p className="home-empty">Aún no tienes cuentas de ahorros.</p>
        ) : (
          <div className="home-savings__list">
            {savingsAccounts.map((account) => (
              <article className="home-savings__item" key={account.id}>
                <img
                  className="home-savings__card"
                  src={getAccountCardImage(account)}
                  alt={`Tarjeta de ahorros de ${account.nombre}`}
                  loading="lazy"
                />
                <div className="home-savings__details">
                  <strong>{account.nombre}</strong>
                  <span>{account.banco}</span>
                </div>
                <strong className="home-savings__value">
                  ${formatMoney(account.saldo)}
                </strong>
              </article>
            ))}
          </div>
        )}
      </section>

      {creditAccounts.length > 0 && (
        <section className="home-credit" aria-labelledby="home-credit-title">
          <div className="home-credit__heading">
            <div>
              <span className="home-savings__eyebrow">Crédito</span>
              <h2 id="home-credit-title">Mis tarjetas</h2>
            </div>
            <div className="home-credit__total">
              <strong>${formatMoney(creditAccounts.reduce((total, account) => total + Number(account.deudaActual || 0), 0))}</strong>
              <span>Deuda total</span>
            </div>
          </div>
          <div className="home-credit__list">
            {creditAccounts.map((account) => {
              const limit = Number(account.limiteCredito || 0);
              const debt = Number(account.deudaActual || 0);
              const utilization = limit > 0 ? Math.min(100, (debt / limit) * 100) : 0;
              const usageMetrics = getCreditUsageMetrics(account);
              const spentWidth = limit > 0 ? utilization : 0;
              const spendableAmount = Math.min(
                usageMetrics.remainingToSpend,
                Math.max(0, limit - debt)
              );
              const spendableWidth = limit > 0
                ? Math.min(100 - spentWidth, (spendableAmount / limit) * 100)
                : 0;
              const amountShownAsReserved = limit > 0
                ? Math.max(0, limit - Math.min(debt, limit) - spendableAmount)
                : 0;
              const reservedWidth = limit > 0 ? (amountShownAsReserved / limit) * 100 : 0;
              return (
                <article className="home-credit__item" key={account.id}>
                  <img
                    className="home-credit__card"
                    src={getAccountCardImage(account)}
                    alt={`Tarjeta de crédito ${account.nombre}`}
                    loading="lazy"
                  />
                  <div className="home-credit__details">
                    <div>
                      <strong>{account.nombre}</strong>
                      <span>{account.banco}</span>
                    </div>
                    <div className="home-credit__usage-heading">
                      <strong>Uso del cupo</strong>
                      <span>Cupo total · ${formatMoney(limit)}</span>
                    </div>
                    <div className="home-credit__usage-values">
                      <div className="home-credit__usage-value home-credit__usage-value--spent">
                        <span>Gastado</span>
                        <strong>${formatMoney(debt)}</strong>
                      </div>
                      <div className="home-credit__usage-value home-credit__usage-value--spendable">
                        <span>Puedes gastar</span>
                        <strong>${formatMoney(spendableAmount)}</strong>
                      </div>
                      <div className="home-credit__usage-value home-credit__usage-value--reserved">
                        <span>No puedes gastar</span>
                        <strong>${formatMoney(amountShownAsReserved)}</strong>
                      </div>
                    </div>
                    <div
                      className="home-credit__track"
                      role="progressbar"
                      aria-label={`Uso del cupo de ${account.nombre}`}
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow={Math.round(utilization)}
                      aria-valuetext={`Gastado: $${formatMoney(debt)}. Puedes gastar: $${formatMoney(spendableAmount)}. Reservado, no gastar: $${formatMoney(amountShownAsReserved)}.`}
                    >
                      <span className="home-credit__track-spent" style={{ width: `${spentWidth}%` }} />
                      <span className="home-credit__track-spendable" style={{ width: `${spendableWidth}%` }} />
                      <span className="home-credit__track-reserved" style={{ width: `${reservedWidth}%` }} />
                    </div>
                    <span className="home-credit__usage-limit">
                      Tope configurado: {usageMetrics.usagePercentage}% · ${formatMoney(usageMetrics.allowedDebt)}
                    </span>
                    <div className="home-credit__conditions">
                      <span>Fecha de corte <strong>{account.fechaCorte ? `Día ${account.fechaCorte}` : "Sin configurar"}</strong></span>
                      <span>Límite de pago <strong>{account.fechaLimitePago ? `Día ${account.fechaLimitePago}` : "Sin configurar"}</strong></span>
                      <span>Tasa mensual <strong>{account.tasaInteresMensual !== null && account.tasaInteresMensual !== undefined ? `${Number(account.tasaInteresMensual).toLocaleString("es-CO", { maximumFractionDigits: 2 })}%` : "Sin configurar"}</strong></span>
                      <span>Tasa E.A. <strong>{account.tasaEfectivaAnual !== null && account.tasaEfectivaAnual !== undefined ? `${Number(account.tasaEfectivaAnual).toLocaleString("es-CO", { maximumFractionDigits: 2 })}%` : "Sin configurar"}</strong></span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {shortcutDraft && (
        <div
          className="home-shortcut-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingShortcut) {
              setShortcutDraft(null);
            }
          }}
        >
          <section
            className="home-shortcut-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-shortcut-title"
          >
            <header className="home-shortcut-modal__header">
              <div>
                <span className="home-savings__eyebrow">Movimiento detectado</span>
                <h2 id="home-shortcut-title">Confirma tu compra</h2>
              </div>
              <button
                type="button"
                className="home-shortcut-modal__close"
                onClick={() => setShortcutDraft(null)}
                disabled={savingShortcut}
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </header>

            <div className="home-shortcut-modal__summary">
              <div className="home-shortcut-modal__amount">
                <span>Importe</span>
                <strong>${Number(shortcutDraft.valor).toLocaleString("es-CO")}</strong>
              </div>
              <div className="home-shortcut-modal__field">
                <span>Método de pago detectado</span>
                {accounts
                  .filter((account) => ["gastos", "credito"].includes(account.tipoCuenta || "gastos"))
                  .filter((account) => (
                    !shortcutDraft.walletAccountMatched || account.id === shortcutDraft.cuentaId
                  ))
                  .map((account) => {
                    const selected = shortcutDraft.cuentaId === account.id;
                    return (
                      <button
                        type="button"
                        key={account.id}
                        className={`home-shortcut-account${selected ? " home-shortcut-account--selected" : ""}`}
                        onClick={() => setShortcutDraft((current) => ({
                          ...current,
                          cuentaId: account.id,
                          cuotas: account.tipoCuenta === "credito" ? current.cuotas || 1 : 1,
                        }))}
                        disabled={savingShortcut || shortcutDraft.walletAccountMatched}
                        aria-pressed={selected}
                      >
                        <img src={getAccountCardImage(account)} alt="" />
                        <span className="home-shortcut-account__details">
                          <strong>{account.nombre}</strong>
                          <span>{account.banco} · {account.tipoCuenta === "credito" ? "Crédito" : "Débito"}</span>
                          {account.namewallet && <small>Wallet: {account.namewallet}</small>}
                          <small>
                            {account.tipoCuenta === "credito"
                              ? `Disponible: $${Number(account.saldo || 0).toLocaleString("es-CO")}`
                              : `Saldo: $${Number(account.saldo || 0).toLocaleString("es-CO")}`}
                          </small>
                        </span>
                        {selected && <Check size={19} aria-hidden="true" />}
                      </button>
                    );
                  })}
                <small>
                  Atajo: {shortcutDraft.tarjeta}
                </small>
              </div>
            </div>

            <div className="home-shortcut-modal__fields">
              {accounts.find((account) => account.id === shortcutDraft.cuentaId)?.tipoCuenta === "credito" && (
                <label className="home-shortcut-modal__field">
                  <span>Cuotas de esta compra</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={2}
                    value={shortcutDraft.cuotas ?? 1}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (/^\d*$/.test(value)) {
                        setShortcutDraft((current) => ({
                          ...current,
                          cuotas: value,
                        }));
                      }
                    }}
                    disabled={savingShortcut}
                  />
                  {shortcutInstallmentAmounts.length > 0 && (
                    <small className="home-shortcut-installment-preview">
                      <strong>
                        {shortcutInstallmentCount} cuotas · desde ${formatMoney(shortcutMonthlyInstallment)} al mes
                      </strong>
                      Total financiado: ${formatMoney(shortcutInstallmentTotal)}
                      {shortcutInstallmentAmounts.some((amount) => amount !== shortcutMonthlyInstallment) &&
                        ` · Cuotas: ${shortcutInstallmentAmounts.map((amount, index) =>
                          `${index + 1}: $${formatMoney(amount)}`
                        ).join(" · ")}`}
                    </small>
                  )}
                </label>
              )}
              <label className="home-shortcut-modal__field">
                <span>Establecimiento legal</span>
                <input type="text" value={shortcutDraft.establecimiento} readOnly />
              </label>
              <label className="home-shortcut-modal__field">
                <span>Nombre para identificarlo</span>
                <input
                  type="text"
                  value={shortcutDraft.nombreEstablecimiento}
                  onChange={(event) => setShortcutDraft((current) => ({
                    ...current,
                    nombreEstablecimiento: event.target.value,
                  }))}
                  placeholder="Ej. Supermercado del barrio"
                  disabled={savingShortcut}
                />
              </label>
              <div className="home-shortcut-modal__location">
                <MapPin size={17} aria-hidden="true" />
                <span>
                  Ubicación · {shortcutDraft.ubicacion.latitud}, {shortcutDraft.ubicacion.longitud}
                </span>
              </div>
              <label className="home-shortcut-modal__field">
                <span>Fecha y hora</span>
                <input
                  type="text"
                  value={new Date(shortcutDraft.fechaHora).toLocaleString("es-CO")}
                  readOnly
                />
              </label>
            </div>

            <div className="home-shortcut-modal__tag-section">
              <div>
                <h3>Tags</h3>
                <p>
                  {suggestedShortcutTags.length > 0
                    ? "Tags existentes. Los más similares a este movimiento aparecen primero."
                    : "Aún no hay tags guardados. Puedes crear uno escribiéndolo abajo."}
                </p>
              </div>
              {suggestedShortcutTags.length > 0 && (
                <div className="home-shortcut-modal__tags">
                  {suggestedShortcutTags.map((tag) => {
                    const isSelected = shortcutDraft.tags?.includes(tag);
                    return (
                      <button
                        type="button"
                        key={tag}
                        className={`home-shortcut-modal__tag${isSelected ? " home-shortcut-modal__tag--selected" : ""}`}
                        aria-pressed={Boolean(isSelected)}
                        onClick={() => setShortcutDraft((current) => ({
                          ...current,
                          tags: isSelected
                            ? (current.tags || []).filter((item) => item !== tag)
                            : normalizeTagList([...(current.tags || []), tag]),
                        }))}
                        disabled={savingShortcut}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              )}
              <div
                className="home-shortcut-modal__tag-input"
                onClick={(event) => event.currentTarget.querySelector("input").focus()}
              >
                {(shortcutDraft.tags || []).map((tag) => (
                  <span className="home-shortcut-modal__tag-chip" key={tag}>
                    {tag}
                    <button
                      type="button"
                      onClick={() => setShortcutDraft((current) => ({
                        ...current,
                        tags: current.tags.filter((item) => item !== tag),
                      }))}
                      aria-label={`Eliminar ${tag}`}
                      disabled={savingShortcut}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={newShortcutTag}
                  onChange={(event) => setNewShortcutTag(event.target.value.toUpperCase())}
                  onKeyDown={handleShortcutTagKeyDown}
                  placeholder={(shortcutDraft.tags || []).length === 0 ? "Ej. comida, café… (espacio para agregar)" : ""}
                  disabled={savingShortcut}
                />
              </div>
            </div>

            <footer className="home-shortcut-modal__actions">
              <button
                type="button"
                className="home-shortcut-modal__cancel"
                onClick={() => setShortcutDraft(null)}
                disabled={savingShortcut}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="home-shortcut-modal__confirm"
                onClick={handleConfirmShortcut}
                disabled={savingShortcut || !shortcutDraft.cuentaId}
              >
                <Check size={18} aria-hidden="true" />
                {savingShortcut ? "Guardando..." : "Confirmar movimiento"}
              </button>
            </footer>
          </section>
        </div>
      )}
      <button
        type="button"
        className="home-shortcut-button"
        onClick={handlePasteShortcut}
        disabled={readingShortcut || loading}
        aria-label="Pegar movimiento desde el atajo"
        title="Pegar movimiento desde el atajo"
      >
        <ClipboardPaste size={23} aria-hidden="true" />
        <span>Pegar movimiento</span>
      </button>
    </div>
  );
};

export default Home;