import React, { useState } from "react";
import { Check } from "lucide-react";
import { auth, db } from "../../server/api";
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  runTransaction,
} from "firebase/firestore";
import Loading from "../../resources/loading/loading";
import { showToast } from "../../resources/toastcontainer/ToastContainer";
import { formatObligationDate, formatObligationSchedule, getLocalDateString, getNextDueDate } from "./obligaciones/obligationUtils";
import { getAccountCardImage } from "../../resources/imagenes/tarjetas/accountCard";
import { applyCreditAdvance, applyCreditPayment, applyCreditPurchase, getCreditStatementDates, getCreditStatementForPurchase } from "../cuentas/creditAccountUtils";
import "./movimientos.css";

const initialForm = {
  valor: "",
  establecimiento: "",
  fechaHora: "",
};

const initialBudget = {
  fechaProgramada: "",
};

const getObligationMonth = (date) => {
  if (typeof date === "string") return date.slice(0, 7);
  const parsedDate = typeof date?.toDate === "function"
    ? date.toDate()
    : date instanceof Date
      ? date
      : null;
  return parsedDate && !Number.isNaN(parsedDate.getTime())
    ? getLocalDateString(parsedDate).slice(0, 7)
    : "";
};

const wasObligationPaidThisMonth = (obligation, month) => {
  if (obligation.tipo === "pago_tarjeta" && obligation.activa) return false;
  return (getObligationMonth(obligation.fechaUltimoPago) ||
    getObligationMonth(obligation.fechaUltimoPeriodoPagado)) === month;
};

const normalizeTags = (list = []) => {
  const values = Array.isArray(list) ? list : [];
  return [...new Set(
    values
      .map((tag) => String(tag).trim().replace(/,$/, "").toUpperCase())
      .filter(Boolean)
  )];
};

const getCurrentDateTimeValue = () => {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 16);
};

const formatSignedMoneyInput = (value) => {
  const sign = String(value).trim().startsWith("-") ? "-" : "";
  const digits = String(value).replace(/\D/g, "");
  const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return sign && formatted ? `-${formatted}` : formatted;
};

const parseSignedMoney = (value) => {
  if (value === "-") return Number.NaN;
  return Number(String(value).replace(/\./g, ""));
};

const Movimientos = ({ isOpen, onClose }) => {
  const [formValues, setFormValues] = useState(initialForm);
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selectedCuentaId, setSelectedCuentaId] = useState("");
  const [historial, setHistorial] = useState([]);
  const [sugerencia, setSugerencia] = useState(null);
  const [mode, setMode] = useState("pago");
  const [usePreviousDate, setUsePreviousDate] = useState(false);
  const [budgetForm, setBudgetForm] = useState(initialBudget);
  const [budgets, setBudgets] = useState([]);
  const [obligations, setObligations] = useState([]);
  const [obligationPaymentAmounts, setObligationPaymentAmounts] = useState({});
  const [obligationPaymentAccounts, setObligationPaymentAccounts] = useState({});
  const [recurringIncomes, setRecurringIncomes] = useState([]);
  const [recurringIncomeAmounts, setRecurringIncomeAmounts] = useState({});

  React.useEffect(() => {
    const fetchAccounts = async () => {
      const user = auth.currentUser;
      if (!user) return;

      setLoading(true);
      try {
        const accountsQuery = query(
          collection(db, "cuentas"),
          where("usuarioId", "==", user.uid)
        );
        const snapshot = await getDocs(accountsQuery);
        const accountDocs = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => {
            const aTime = a.fechaCreacion?.toMillis ? a.fechaCreacion.toMillis() : 0;
            const bTime = b.fechaCreacion?.toMillis ? b.fechaCreacion.toMillis() : 0;
            return bTime - aTime;
          });
        setAccounts(accountDocs);
        
        // Seleccionar la cuenta predeterminada
        const spendableAccounts = accountDocs.filter(
          (account) => (account.tipoCuenta || "gastos") === "gastos"
        );
        const defaultAccount = spendableAccounts.find((c) => c.esDefault);
        if (defaultAccount) {
          setSelectedCuentaId(defaultAccount.id);
        } else if (spendableAccounts[0]) {
          setSelectedCuentaId(spendableAccounts[0].id);
        }

        const budgetsSnapshot = await getDocs(
          query(collection(db, "presupuestos"), where("usuarioId", "==", user.uid))
        );
        setBudgets(
          budgetsSnapshot.docs
            .map((budgetDoc) => ({ id: budgetDoc.id, ...budgetDoc.data() }))
            .filter((budget) => budget.estado === "pendiente")
            .sort((a, b) => String(a.fechaProgramada).localeCompare(String(b.fechaProgramada)))
        );

        const obligationsSnapshot = await getDocs(
          query(collection(db, "obligaciones"), where("usuarioId", "==", user.uid))
        );
        const recurringIncomesSnapshot = await getDocs(
          query(collection(db, "ingresosRecurrentes"), where("usuarioId", "==", user.uid))
        );
        const currentMonth = getLocalDateString().slice(0, 7);
        const currentObligations = obligationsSnapshot.docs
          .map((obligationDoc) => ({ id: obligationDoc.id, ...obligationDoc.data() }))
          .filter((obligation) =>
            !obligation.anulada && (obligation.activa ||
              wasObligationPaidThisMonth(obligation, currentMonth))
          )
          .sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago)));
        setObligations(currentObligations);
        const defaultFundingAccount = spendableAccounts.find((account) => account.esDefault) || spendableAccounts[0];
        setObligationPaymentAccounts(Object.fromEntries(
          currentObligations
            .filter((obligation) => obligation.tipo === "pago_tarjeta")
            .map((obligation) => [obligation.id, defaultFundingAccount?.id || ""])
        ));
        setObligationPaymentAmounts(Object.fromEntries(
          currentObligations.map((obligation) => [
            obligation.id,
            formatMoneyInput(String(obligation.tipo === "pago_tarjeta"
              ? Number(obligation.montoPendiente ?? obligation.valor ?? 0)
              : Math.min(
                Number(obligation.valor || 0),
                Number(obligation.deudaRestante ?? obligation.valor ?? 0)
              ))),
          ])
        ));
        const activeRecurringIncomes = recurringIncomesSnapshot.docs
          .map((incomeDoc) => ({ id: incomeDoc.id, ...incomeDoc.data() }))
          .filter((income) => income.activa)
          .sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago)));
        setRecurringIncomes(activeRecurringIncomes);
        setRecurringIncomeAmounts(Object.fromEntries(
          activeRecurringIncomes.map((income) => [
            income.id,
            "0",
          ])
        ));

        // Cargar historial de movimientos
        const movimientosQuery = query(
          collection(db, "movimientos"),
          where("userId", "==", user.uid)
        );
        const movimientosSnapshot = await getDocs(movimientosQuery);
        const historialMovimientos = movimientosSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setHistorial(historialMovimientos);
      } catch (error) {
        console.error("Error cargando cuentas:", error);
        showToast("No se pudieron cargar las cuentas", "error");
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      setFormValues({ ...initialForm, fechaHora: getCurrentDateTimeValue() });
      setTags([]);
      setTagInput("");
      setSelectedCuentaId("");
      setMode("pago");
      setUsePreviousDate(false);
      setBudgetForm(initialBudget);
      setBudgets([]);
      setObligations([]);
      setObligationPaymentAmounts({});
      setObligationPaymentAccounts({});
      setRecurringIncomes([]);
      setRecurringIncomeAmounts({});
      fetchAccounts();
    }
  }, [isOpen]);

  const formatMoneyInput = (value) => {
    const digits = value.replace(/\D/g, "");
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  // Para mostrar saldos — preserva el signo negativo
  const formatMoney = (value) => {
    const num = Number(value);
    const abs = String(Math.abs(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return num < 0 ? `-${abs}` : abs;
  };

  const currentMonth = getLocalDateString().slice(0, 7);
  const paidObligationsThisMonth = obligations.filter((obligation) =>
    !obligation.anulada && wasObligationPaidThisMonth(obligation, currentMonth)
  );
  const pendingObligations = obligations.filter((obligation) => {
    if (!obligation.activa || obligation.anulada) return false;
    if (obligation.tipo === "pago_tarjeta") return true;
    const paidThisMonth = wasObligationPaidThisMonth(obligation, currentMonth);
    const nextDueMonth = getObligationMonth(obligation.fechaProximoPago);
    return !paidThisMonth || nextDueMonth <= currentMonth;
  });

  /* ── Función para obtener sugerencias ── */
  const obtenerSugerencia = (establecimiento, valor) => {
    if (!establecimiento || !valor) {
      setSugerencia(null);
      return;
    }

    const numero = Number(String(valor).replace(/\./g, ""));

    const similares = historial.filter((mov) => {
      const nombreActual = establecimiento.toUpperCase();
      const nombreGuardado = mov.establecimiento?.toUpperCase() || "";
      const coincideNombre = nombreGuardado.includes(nombreActual);
      const coincideValor = Math.abs(mov.valor - numero) <= 10000;
      return coincideNombre && coincideValor;
    });

    if (similares.length === 0) {
      setSugerencia(null);
      return;
    }

    const frecuenciaTags = {};
    similares.forEach((m) => {
      (m.tags || []).forEach((tag) => {
        frecuenciaTags[tag] = (frecuenciaTags[tag] || 0) + 1;
      });
    });

    const tagsOrdenados = Object.entries(frecuenciaTags)
      .sort((a, b) => b[1] - a[1])
      .map((item) => item[0]);

    setSugerencia({
      establecimiento: similares[0].establecimiento.toUpperCase(),
      tags: tagsOrdenados,
      confianza: Math.min(
        99,
        Math.round((similares.length / historial.length) * 300)
      ),
    });
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    if (name === "valor") {
      const valorFormateado = value ? formatMoneyInput(value) : "";
      setFormValues((prev) => {
        const nuevo = {
          ...prev,
          valor: valorFormateado,
        };
        obtenerSugerencia(nuevo.establecimiento, nuevo.valor);
        return nuevo;
      });
      return;
    }

    if (name === "establecimiento") {
      const mayuscula = value.toUpperCase();
      setFormValues((prev) => {
        const nuevo = {
          ...prev,
          establecimiento: mayuscula,
        };
        obtenerSugerencia(nuevo.establecimiento, nuevo.valor);
        return nuevo;
      });
      return;
    }

    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleTagKeyDown = (e) => {
    if ((e.key === " " || e.key === "," || e.key === "Enter") && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim().replace(/,$/, "").toUpperCase();
      if (newTag) {
        setTags((prev) => normalizeTags([...prev, newTag]));
      }
      setTagInput("");
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const removeTag = (index) => {
    setTags((prev) => prev.filter((_, i) => i !== index));
  };

  const getAvailableBalance = (accountId) => {
    const account = accounts.find((item) => item.id === accountId);
    const reserved = budgets
      .filter((budget) => budget.cuentaId === accountId)
      .reduce((total, budget) => total + Number(budget.valor || 0), 0);
    return Number(account?.saldo || 0) - reserved;
  };

  const selectedAccount = accounts.find((account) => account.id === selectedCuentaId);

  const resetForm = () => {
    setFormValues({ ...initialForm, fechaHora: getCurrentDateTimeValue() });
    setTags([]);
    setTagInput("");
    setSugerencia(null);
    setUsePreviousDate(false);
    setBudgetForm(initialBudget);
  };

  const changeMode = (nextMode) => {
    setMode(nextMode);
    if (nextMode !== mode) {
      setUsePreviousDate(false);
    }
    if (nextMode === "avance") {
      const selectedCreditAccount = accounts.find(
        (account) => account.id === selectedCuentaId && account.tipoCuenta === "credito"
      );
      const firstCreditAccount = accounts.find((account) => account.tipoCuenta === "credito");
      if (!selectedCreditAccount && firstCreditAccount) {
        setSelectedCuentaId(firstCreditAccount.id);
      }
    }
  };

  const handleCreateBudget = async () => {
    const valor = Number(formValues.valor.replace(/\./g, ""));
    const establecimiento = formValues.establecimiento.trim().toUpperCase();
    const user = auth.currentUser;
    const finalTags = normalizeTags(tagInput.trim() ? [...tags, tagInput.trim()] : tags);

    if (!user) { showToast("Necesitas iniciar sesión", "error"); return; }
    if (!selectedCuentaId) { showToast("Selecciona una cuenta para presupuestar", "error"); return; }
    if (!valor || !establecimiento || !budgetForm.fechaProgramada) {
      showToast("Completa el valor, establecimiento y fecha", "error"); return;
    }

    const cuentaSeleccionada = accounts.find((c) => c.id === selectedCuentaId);
    if (!cuentaSeleccionada) { showToast("Cuenta inválida", "error"); return; }
    if ((cuentaSeleccionada.tipoCuenta || "gastos") !== "gastos") {
      showToast("Las cuentas de ahorros son una alcancía y no se pueden usar para pagos", "error"); return;
    }
    if (valor > getAvailableBalance(selectedCuentaId)) {
      showToast("El presupuesto supera el saldo disponible después de las reservas", "error"); return;
    }

    setLoading(true);
    try {
      const budgetData = {
        usuarioId: user.uid,
        cuentaId: selectedCuentaId,
        cuentaBanco: cuentaSeleccionada.banco,
        cuentaNombre: cuentaSeleccionada.nombre,
        valor,
        establecimiento,
        tags: finalTags,
        fechaProgramada: budgetForm.fechaProgramada,
        estado: "pendiente",
        fechaCreacion: serverTimestamp(),
      };
      const budgetRef = await addDoc(collection(db, "presupuestos"), budgetData);
      setBudgets((prev) => [{ id: budgetRef.id, ...budgetData }, ...prev]);
      showToast("Presupuesto guardado. El saldo no ha cambiado", "success");
      resetForm();
    } catch (error) {
      console.error("Error guardando presupuesto:", error);
      showToast("No se pudo guardar el presupuesto", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptBudget = async (budget) => {
    const cuentaSeleccionada = accounts.find((c) => c.id === budget.cuentaId);
    if (!cuentaSeleccionada) { showToast("La cuenta del presupuesto ya no existe", "error"); return; }
    if ((cuentaSeleccionada.tipoCuenta || "gastos") !== "gastos") {
      showToast("Este presupuesto pertenece a una cuenta de ahorros", "error"); return;
    }
    if (Number(budget.valor) > Number(cuentaSeleccionada.saldo || 0)) {
      showToast("Saldo insuficiente para aceptar este presupuesto", "error"); return;
    }

    setLoading(true);
    try {
      const nuevoSaldo = Number(cuentaSeleccionada.saldo || 0) - Number(budget.valor);
      await updateDoc(doc(db, "cuentas", budget.cuentaId), {
        saldo: nuevoSaldo,
        ultimaActualizacion: serverTimestamp(),
      });
      await addDoc(collection(db, "movimientos"), {
        userId: auth.currentUser.uid,
        usuarioId: auth.currentUser.uid,
        cuentaId: budget.cuentaId,
        cuentaBanco: cuentaSeleccionada.banco,
        cuentaNombre: cuentaSeleccionada.nombre,
        valor: Number(budget.valor),
        establecimiento: budget.establecimiento,
        tags: budget.tags || [],
        fechaHora: new Date(),
        fechaCreacion: serverTimestamp(),
      });
      await updateDoc(doc(db, "presupuestos", budget.id), {
        estado: "aceptado",
        fechaAceptacion: serverTimestamp(),
      });
      setAccounts((prev) => prev.map((account) =>
        account.id === budget.cuentaId ? { ...account, saldo: nuevoSaldo } : account
      ));
      setBudgets((prev) => prev.filter((item) => item.id !== budget.id));
      showToast("Presupuesto aceptado y pago registrado", "success");
    } catch (error) {
      console.error("Error aceptando presupuesto:", error);
      showToast("No se pudo aceptar el presupuesto", "error");
    } finally {
      setLoading(false);
    }
  };

  const handlePayObligation = async (obligation, amount) => {
    if (obligation.tipo === "pago_tarjeta") {
      await handlePayCreditObligation(obligation, amount);
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      showToast("Necesitas iniciar sesión", "error");
      return;
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showToast("Ingresa el valor realmente pagado", "error");
      return;
    }

    const obligationRef = doc(db, "obligaciones", obligation.id);
    const accountRef = doc(db, "cuentas", obligation.cuentaId);
    const movementRef = doc(collection(db, "movimientos"));
    const paymentDate = new Date();
    setLoading(true);

    try {
      const payment = await runTransaction(db, async (transaction) => {
        const obligationSnapshot = await transaction.get(obligationRef);
        if (!obligationSnapshot.exists() || !obligationSnapshot.data().activa) {
          throw new Error("OBLIGATION_UNAVAILABLE");
        }
        const currentObligation = obligationSnapshot.data();
        if (currentObligation.usuarioId !== user.uid) {
          throw new Error("OBLIGATION_UNAVAILABLE");
        }
        const debtRef = currentObligation.deudaId
          ? doc(db, "deudas", currentObligation.deudaId)
          : null;
        const accountSnapshot = await transaction.get(accountRef);
        if (!accountSnapshot.exists()) {
          throw new Error("ACCOUNT_UNAVAILABLE");
        }
        const debtSnapshot = debtRef ? await transaction.get(debtRef) : null;

        const account = accountSnapshot.data();
        const balance = Number(account.saldo || 0);
        if (account.usuarioId !== user.uid || (account.tipoCuenta || "gastos") !== "gastos") {
          throw new Error("ACCOUNT_UNAVAILABLE");
        }
        if (balance < amount) {
          throw new Error("INSUFFICIENT_BALANCE");
        }

        let remainingDebt = null;
        let debtPaid = false;
        if (debtRef) {
          if (!debtSnapshot?.exists()) throw new Error("DEBT_UNAVAILABLE");
          const debt = debtSnapshot.data();
          if (debt.usuarioId !== user.uid || debt.obligacionId !== obligation.id) {
            throw new Error("DEBT_UNAVAILABLE");
          }
          remainingDebt = Number(debt.montoRestante ?? debt.monto ?? 0);
          if (remainingDebt <= 0) throw new Error("DEBT_ALREADY_PAID");
          if (amount > remainingDebt) throw new Error("PAYMENT_EXCEEDS_DEBT");
          remainingDebt -= amount;
          debtPaid = remainingDebt <= 0;
        }

        const nextDueDate = debtPaid ? null : getNextDueDate(
          currentObligation.frecuencia,
          currentObligation.fechaProximoPago,
          currentObligation.diaVencimiento,
          currentObligation.diaSegundoPago,
          currentObligation.proximoPagoNumero || 1
        );
        const nextPaymentNumber = currentObligation.frecuencia === "quincenal"
          ? (currentObligation.proximoPagoNumero || 1) === 1 ? 2 : 1
          : 1;
        transaction.update(accountRef, {
          saldo: balance - amount,
          ultimaActualizacion: serverTimestamp(),
        });
        transaction.update(obligationRef, {
          fechaUltimoPeriodoPagado: currentObligation.fechaProximoPago,
          fechaUltimoPago: serverTimestamp(),
          ...(nextDueDate ? {
            fechaProximoPago: nextDueDate,
            proximoPagoNumero: nextPaymentNumber,
          } : {}),
          ...(debtRef ? {
            deudaRestante: remainingDebt,
            ...(debtPaid ? { activa: false, deudaPagada: true } : {}),
          } : {}),
        });
        if (debtRef) {
          transaction.update(debtRef, {
            montoRestante: remainingDebt,
            pagada: debtPaid,
            ultimaActualizacion: serverTimestamp(),
          });
        }
        transaction.set(movementRef, {
          userId: user.uid,
          usuarioId: user.uid,
          cuentaId: obligation.cuentaId,
          cuentaBanco: account.banco || "",
          cuentaNombre: account.nombre || "",
          valor: amount,
          establecimiento: currentObligation.nombre,
          tags: ["OBLIGACION"],
          obligacionId: obligation.id,
          ...(debtRef ? { deudaId: currentObligation.deudaId } : {}),
          origen: "obligacion",
          fechaHora: paymentDate,
          fechaCreacion: serverTimestamp(),
        });

        return {
          balance: balance - amount,
          nextDueDate,
          nextPaymentNumber,
          remainingDebt,
          debtPaid,
          debtId: currentObligation.deudaId || null,
          paidPeriod: currentObligation.fechaProximoPago,
          paidAt: paymentDate,
        };
      });

      setAccounts((current) => current.map((account) => account.id === obligation.cuentaId
        ? { ...account, saldo: payment.balance }
        : account));
      if (payment.debtPaid) {
        setObligations((current) => current.map((item) => item.id === obligation.id
          ? {
            ...item,
            activa: false,
            deudaPagada: true,
            deudaRestante: 0,
            fechaUltimoPago: payment.paidAt,
            fechaUltimoPeriodoPagado: payment.paidPeriod,
          }
          : item));
        setObligationPaymentAmounts((current) => ({ ...current, [obligation.id]: "0" }));
        showToast("🎉 Deuda pagada completamente; la obligación se desactivó", "success");
      } else {
        setObligations((current) => current.map((item) => item.id === obligation.id
          ? {
            ...item,
            fechaUltimoPago: payment.paidAt,
            fechaUltimoPeriodoPagado: payment.paidPeriod,
            ...(payment.nextDueDate ? { fechaProximoPago: payment.nextDueDate } : {}),
            proximoPagoNumero: payment.nextPaymentNumber,
            ...(obligation.deudaId ? { deudaRestante: payment.remainingDebt } : {}),
          }
          : item).sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago))));
        if (obligation.deudaId) {
          setObligationPaymentAmounts((current) => ({
            ...current,
            [obligation.id]: formatMoneyInput(String(Math.min(Number(obligation.valor || 0), payment.remainingDebt))),
          }));
        }
        showToast(`Obligación cubierta. Próximo pago: ${formatObligationDate(payment.nextDueDate)}`, "success");
      }
    } catch (error) {
      console.error("Error pagando obligación:", error);
      if (error.message === "INSUFFICIENT_BALANCE") {
        showToast("Saldo insuficiente para pagar esta obligación", "error");
      } else if (error.message === "PAYMENT_EXCEEDS_DEBT") {
        showToast("El pago no puede superar el saldo pendiente de la deuda", "error");
      } else if (error.message === "DEBT_UNAVAILABLE" || error.message === "DEBT_ALREADY_PAID") {
        showToast("La deuda asociada ya no está pendiente", "error");
      } else if (error.message === "OBLIGATION_UNAVAILABLE") {
        showToast("Esta obligación ya no está activa", "error");
      } else {
        showToast("No se pudo pagar la obligación", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePayCreditObligation = async (obligation, amount) => {
    const user = auth.currentUser;
    const sourceAccountId = obligationPaymentAccounts[obligation.id];
    const sourceAccount = accounts.find((account) => account.id === sourceAccountId);
    if (!user) {
      showToast("Necesitas iniciar sesión", "error");
      return;
    }
    if (!sourceAccount || sourceAccount.tipoCuenta === "credito") {
      showToast("Selecciona una cuenta de gastos para pagar la tarjeta", "error");
      return;
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showToast("Ingresa el valor realmente pagado", "error");
      return;
    }

    const obligationRef = doc(db, "obligaciones", obligation.id);
    const sourceRef = doc(db, "cuentas", sourceAccountId);
    const movementRef = doc(collection(db, "movimientos"));
    const paymentDate = new Date();
    setLoading(true);
    try {
      const payment = await runTransaction(db, async (transaction) => {
        const obligationSnapshot = await transaction.get(obligationRef);
        if (!obligationSnapshot.exists()) throw new Error("OBLIGATION_UNAVAILABLE");
        const currentObligation = obligationSnapshot.data();
        if (!currentObligation.activa || currentObligation.usuarioId !== user.uid ||
          currentObligation.tipo !== "pago_tarjeta") {
          throw new Error("OBLIGATION_UNAVAILABLE");
        }
        const cardRef = doc(db, "cuentas", currentObligation.tarjetaId);
        const sourceSnapshot = await transaction.get(sourceRef);
        const cardSnapshot = await transaction.get(cardRef);
        if (!sourceSnapshot.exists() || !cardSnapshot.exists()) {
          throw new Error("ACCOUNT_UNAVAILABLE");
        }

        const fundingAccount = sourceSnapshot.data();
        const cardAccount = cardSnapshot.data();
        if (fundingAccount.usuarioId !== user.uid || (fundingAccount.tipoCuenta || "gastos") !== "gastos" ||
          cardAccount.usuarioId !== user.uid || cardAccount.tipoCuenta !== "credito") {
          throw new Error("ACCOUNT_UNAVAILABLE");
        }
        const balance = Number(fundingAccount.saldo || 0);
        if (balance < amount) throw new Error("INSUFFICIENT_BALANCE");
        const statementRemaining = Number(currentObligation.montoPendiente ?? currentObligation.valor ?? 0);
        if (amount > statementRemaining) throw new Error("PAYMENT_EXCEEDS_STATEMENT");
        const creditChanges = applyCreditPayment(cardAccount, amount);
        const remaining = statementRemaining - amount;
        const paid = remaining <= 0;

        transaction.update(sourceRef, {
          saldo: balance - amount,
          ultimaActualizacion: serverTimestamp(),
        });
        transaction.update(cardRef, {
          ...creditChanges,
          ultimaActualizacion: serverTimestamp(),
        });
        transaction.update(obligationRef, {
          montoPendiente: remaining,
          activa: !paid,
          fechaUltimoPago: serverTimestamp(),
          ...(paid ? { fechaUltimoPeriodoPagado: currentObligation.fechaCorte } : {}),
          ultimaActualizacion: serverTimestamp(),
        });
        transaction.set(movementRef, {
          userId: user.uid,
          usuarioId: user.uid,
          cuentaId: sourceAccountId,
          cuentaBanco: fundingAccount.banco || "",
          cuentaNombre: fundingAccount.nombre || "",
          cuentaDestinoId: currentObligation.tarjetaId,
          cuentaDestinoBanco: cardAccount.banco || "",
          cuentaDestinoNombre: cardAccount.nombre || "",
          valor: amount,
          descripcion: `PAGO EXTRACTO TARJETA ${cardAccount.nombre || ""}`.trim(),
          tipo: "pago_tarjeta",
          origen: "obligacion_tarjeta",
          obligacionAbonos: [{ obligacionId: obligation.id, valor: amount }],
          fechaHora: paymentDate,
          fechaCreacion: serverTimestamp(),
        });

        return {
          sourceBalance: balance - amount,
          cardBalance: creditChanges.saldo,
          cardDebt: creditChanges.deudaActual,
          remaining,
          paid,
          paidAt: paymentDate,
          cutoffDate: currentObligation.fechaCorte,
          cardId: currentObligation.tarjetaId,
        };
      });

      setAccounts((current) => current.map((account) => {
        if (account.id === sourceAccountId) return { ...account, saldo: payment.sourceBalance };
        if (account.id === payment.cardId) {
          return { ...account, saldo: payment.cardBalance, deudaActual: payment.cardDebt };
        }
        return account;
      }));
      setObligations((current) => current.map((item) => item.id === obligation.id
        ? {
          ...item,
          montoPendiente: payment.remaining,
          activa: !payment.paid,
          fechaUltimoPago: payment.paidAt,
          ...(payment.paid ? { fechaUltimoPeriodoPagado: payment.cutoffDate } : {}),
        }
        : item));
      setObligationPaymentAmounts((current) => ({
        ...current,
        [obligation.id]: payment.paid ? "0" : formatMoneyInput(String(payment.remaining)),
      }));
      showToast(payment.paid
        ? "Pago del extracto registrado; tarjeta abonada"
        : `Abono registrado. Saldo del extracto: $${formatMoney(payment.remaining)}`, "success");
    } catch (error) {
      console.error("Error pagando extracto de tarjeta:", error);
      if (error.message === "INSUFFICIENT_BALANCE") {
        showToast("Saldo insuficiente en la cuenta para este pago", "error");
      } else if (error.message === "PAYMENT_EXCEEDS_STATEMENT") {
        showToast("El pago no puede superar el saldo pendiente de este extracto", "error");
      } else if (error.message === "PAYMENT_EXCEEDS_CREDIT_DEBT") {
        showToast("El saldo actual de la tarjeta no permite aplicar este pago", "error");
      } else if (error.message === "OBLIGATION_UNAVAILABLE") {
        showToast("Este extracto ya no está pendiente", "error");
      } else {
        showToast("No se pudo pagar el extracto de la tarjeta", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptRecurringIncome = async (income, amount) => {
    const user = auth.currentUser;
    if (!user) {
      showToast("Necesitas iniciar sesión", "error");
      return;
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showToast("Ingresa el valor realmente recibido", "error");
      return;
    }

    const incomeRef = doc(db, "ingresosRecurrentes", income.id);
    const accountRef = doc(db, "cuentas", income.cuentaId);
    const movementRef = doc(collection(db, "movimientos"));
    const receivedAt = new Date();

    setLoading(true);
    try {
      const payment = await runTransaction(db, async (transaction) => {
        const incomeSnapshot = await transaction.get(incomeRef);
        if (!incomeSnapshot.exists() || !incomeSnapshot.data().activa ||
          incomeSnapshot.data().usuarioId !== user.uid) {
          throw new Error("RECURRING_INCOME_UNAVAILABLE");
        }
        const accountSnapshot = await transaction.get(accountRef);
        if (!accountSnapshot.exists()) throw new Error("ACCOUNT_UNAVAILABLE");
        const currentIncome = incomeSnapshot.data();
        const account = accountSnapshot.data();
        if (account.usuarioId !== user.uid || account.tipoCuenta === "credito") {
          throw new Error("ACCOUNT_UNAVAILABLE");
        }
        const balance = Number(account.saldo || 0);
        if (!Number.isSafeInteger(balance + amount)) {
          throw new Error("INVALID_INCOME_AMOUNT");
        }

        const currentPaymentNumber = Number(currentIncome.proximoPagoNumero || 1);
        const nextPaymentNumber = currentIncome.frecuencia === "quincenal"
          ? currentPaymentNumber === 1 ? 2 : 1
          : 1;
        const nextDueDate = getNextDueDate(
          currentIncome.frecuencia || "mensual",
          currentIncome.fechaProximoPago,
          currentIncome.diaVencimiento,
          currentIncome.diaSegundoPago,
          currentPaymentNumber
        );
        transaction.update(accountRef, {
          saldo: balance + amount,
          ultimaActualizacion: serverTimestamp(),
        });
        transaction.update(incomeRef, {
          fechaUltimoIngreso: currentIncome.fechaProximoPago,
          fechaUltimoPago: serverTimestamp(),
          fechaProximoPago: nextDueDate,
          proximoPagoNumero: nextPaymentNumber,
        });
        transaction.set(movementRef, {
          userId: user.uid,
          usuarioId: user.uid,
          cuentaId: currentIncome.cuentaId,
          cuentaBanco: account.banco || "",
          cuentaNombre: account.nombre || "",
          valor: amount,
          descripcion: currentIncome.nombre,
          tipo: "ingreso_recurrente",
          origen: "ingreso_recurrente",
          ingresoRecurrenteId: income.id,
          fechaHora: receivedAt,
          fechaCreacion: serverTimestamp(),
        });
        return { balance: balance + amount, nextDueDate, nextPaymentNumber };
      });

      setAccounts((current) => current.map((account) => account.id === income.cuentaId
        ? { ...account, saldo: payment.balance }
        : account));
      setRecurringIncomes((current) => current.map((item) => item.id === income.id
        ? {
          ...item,
          fechaProximoPago: payment.nextDueDate,
          proximoPagoNumero: payment.nextPaymentNumber,
        }
        : item).sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago))));
      setRecurringIncomeAmounts((current) => ({
        ...current,
        [income.id]: "0",
      }));
      showToast(`Ingreso registrado. Próximo: ${formatObligationDate(payment.nextDueDate)}`, "success");
    } catch (error) {
      console.error("Error aceptando ingreso recurrente:", error);
      if (error.message === "RECURRING_INCOME_UNAVAILABLE") {
        showToast("Este ingreso recurrente ya no está activo", "error");
      } else if (error.message === "ACCOUNT_UNAVAILABLE") {
        showToast("La cuenta receptora ya no está disponible", "error");
      } else if (error.message === "INVALID_INCOME_AMOUNT") {
        showToast("El saldo resultante supera el valor permitido", "error");
      } else {
        showToast("No se pudo registrar el ingreso", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (mode === "presupuesto") {
      await handleCreateBudget();
      return;
    }

    const valor = Number(formValues.valor.replace(/\./g, ""));
    const establecimiento = formValues.establecimiento.trim().toUpperCase();
    const fechaHora = usePreviousDate
      ? new Date(formValues.fechaHora)
      : new Date();
    const finalTags = normalizeTags(tagInput.trim() ? [...tags, tagInput.trim()] : tags);

    const user = auth.currentUser;
    if (!user) { showToast("Necesitas iniciar sesión", "error"); return; }
    if (!selectedCuentaId) { showToast("Selecciona una cuenta para pagar", "error"); return; }
    if (!valor || !establecimiento) { showToast("Completa todos los campos del movimiento", "error"); return; }
    if (usePreviousDate && (!formValues.fechaHora || Number.isNaN(fechaHora.getTime()))) {
      showToast("Selecciona una fecha y hora válidas", "error"); return;
    }
    if (usePreviousDate && fechaHora > new Date()) {
      showToast("La fecha y hora no pueden estar en el futuro", "error"); return;
    }

    const cuentaSeleccionada = accounts.find((c) => c.id === selectedCuentaId);
    if (!cuentaSeleccionada) { showToast("Cuenta inválida", "error"); return; }
    if (mode === "avance") {
      if (cuentaSeleccionada.tipoCuenta !== "credito") {
        showToast("Selecciona una tarjeta de crédito para registrar el avance", "error");
        return;
      }

      const cargoAvance = Number(cuentaSeleccionada.cargoAvance);
      const cuotas = Number(cuentaSeleccionada.maximoCuotasAvance);
      if (!Number.isSafeInteger(cargoAvance) || cargoAvance < 0 ||
        !Number.isSafeInteger(cuotas) || cuotas < 1) {
        showToast("Configura el cargo por avance y el máximo de cuotas en la cuenta", "error");
        return;
      }

      setLoading(true);
      try {
        const accountRef = doc(db, "cuentas", selectedCuentaId);
        const movementRef = doc(collection(db, "movimientos"));
        const creditResult = await runTransaction(db, async (transaction) => {
          const accountSnapshot = await transaction.get(accountRef);
          if (!accountSnapshot.exists()) throw new Error("CREDIT_ACCOUNT_NOT_FOUND");

          const account = accountSnapshot.data();
          if (account.usuarioId !== user.uid || account.tipoCuenta !== "credito") {
            throw new Error("CREDIT_ACCOUNT_INVALID");
          }
          const creditChanges = applyCreditAdvance(account, valor);
          const cargoConfigurado = Number(account.cargoAvance);
          const cuotasConfiguradas = Number(account.maximoCuotasAvance);
          if (!Number.isSafeInteger(cuotasConfiguradas) || cuotasConfiguradas < 1) {
            throw new Error("INVALID_CREDIT_ADVANCE_INSTALLMENTS");
          }
          const valorTotal = valor + cargoConfigurado;
          const statementDates = getCreditStatementForPurchase(account, fechaHora);
          if (!statementDates) throw new Error("CREDIT_STATEMENT_DATES_UNAVAILABLE");
          const startDate = getLocalDateString(statementDates.startDate);
          const cutoffDate = getLocalDateString(statementDates.cutoffDate);
          const paymentDate = getLocalDateString(statementDates.paymentDate);
          const obligationId = `tarjeta-${selectedCuentaId}-${cutoffDate}`;
          const obligationRef = doc(db, "obligaciones", obligationId);
          const obligationSnapshot = await transaction.get(obligationRef);
          const previousObligation = obligationSnapshot.exists() ? obligationSnapshot.data() : null;
          if (previousObligation && (
            previousObligation.usuarioId !== user.uid ||
            previousObligation.tarjetaId !== selectedCuentaId
          )) {
            throw new Error("CREDIT_OBLIGATION_CONFLICT");
          }
          const totalStatement = Number(previousObligation?.valor || 0) + valorTotal;
          const remainingStatement =
            Number(previousObligation?.montoPendiente ?? previousObligation?.valor ?? 0) + valorTotal;

          transaction.update(accountRef, {
            ...creditChanges,
            ultimaActualizacion: serverTimestamp(),
          });
          transaction.set(obligationRef, {
            usuarioId: user.uid,
            tipo: "pago_tarjeta",
            nombre: `PAGO TARJETA ${account.nombre || account.banco || ""}`.trim(),
            tarjetaId: selectedCuentaId,
            tarjetaNombre: account.nombre || "",
            tarjetaBanco: account.banco || "",
            cuentaNombre: `${account.banco || ""} · ${account.nombre || ""}`.trim(),
            fechaInicioCiclo: startDate,
            fechaCorte: cutoffDate,
            fechaProximoPago: paymentDate,
            diaVencimiento: Number(paymentDate.slice(-2)),
            frecuencia: "mensual",
            valor: totalStatement,
            montoPendiente: remainingStatement,
            activa: remainingStatement > 0,
            anulada: false,
            ...(previousObligation?.fechaCreacion ? {} : { fechaCreacion: serverTimestamp() }),
            ultimaActualizacion: serverTimestamp(),
          });
          transaction.set(movementRef, {
            userId: user.uid,
            usuarioId: user.uid,
            cuentaId: selectedCuentaId,
            cuentaBanco: account.banco || "",
            cuentaNombre: account.nombre || "",
            valor: valorTotal,
            valorAvance: valor,
            cargoAvance: cargoConfigurado,
            cuotas: cuotasConfiguradas,
            establecimiento,
            tags: finalTags,
            tipo: "credito_avance",
            origen: "tarjeta_credito",
            obligacionId: obligationId,
            fechaCorteTarjeta: cutoffDate,
            fechaLimitePagoTarjeta: paymentDate,
            fechaHora,
            fechaCreacion: serverTimestamp(),
          });

          return {
            available: creditChanges.saldo,
            debt: creditChanges.deudaActual,
            valorTotal,
            installments: cuotasConfiguradas,
            obligation: {
              id: obligationId,
              usuarioId: user.uid,
              tipo: "pago_tarjeta",
              nombre: `PAGO TARJETA ${account.nombre || account.banco || ""}`.trim(),
              tarjetaId: selectedCuentaId,
              tarjetaNombre: account.nombre || "",
              tarjetaBanco: account.banco || "",
              cuentaNombre: `${account.banco || ""} · ${account.nombre || ""}`.trim(),
              fechaInicioCiclo: startDate,
              fechaCorte: cutoffDate,
              fechaProximoPago: paymentDate,
              diaVencimiento: Number(paymentDate.slice(-2)),
              frecuencia: "mensual",
              valor: totalStatement,
              montoPendiente: remainingStatement,
              activa: remainingStatement > 0,
              anulada: false,
            },
          };
        });

        setAccounts((current) => current.map((account) => account.id === selectedCuentaId
          ? { ...account, saldo: creditResult.available, deudaActual: creditResult.debt }
          : account));
        setObligations((current) => [
          ...current.filter((obligation) => obligation.id !== creditResult.obligation.id),
          creditResult.obligation,
        ].sort((first, second) =>
          String(first.fechaProximoPago).localeCompare(String(second.fechaProximoPago))
        ));
        setHistorial((current) => [...current, {
          id: Date.now().toString(),
          establecimiento,
          valor: creditResult.valorTotal,
          tags: finalTags,
        }]);
        showToast(`Avance registrado por $${formatMoney(creditResult.valorTotal)} en ${creditResult.installments} cuotas`, "success");
        resetForm();
        return;
      } catch (error) {
        console.error("Error guardando avance de tarjeta:", error);
        showToast(error.message === "CREDIT_LIMIT_EXCEEDED"
          ? "El avance y su cargo superan el cupo disponible de la tarjeta"
          : "No se pudo registrar el avance", "error");
        return;
      } finally {
        setLoading(false);
      }
    }
    if (cuentaSeleccionada.tipoCuenta === "ahorros") {
      showToast("Las cuentas de ahorros no se pueden usar para pagos", "error"); return;
    }
    const isCreditAccount = cuentaSeleccionada.tipoCuenta === "credito";
    if (!isCreditAccount && valor > getAvailableBalance(selectedCuentaId)) {
      showToast("Saldo disponible insuficiente: hay dinero reservado en presupuestos", "error"); return;
    }

    setLoading(true);
    try {
      if (isCreditAccount) {
        const accountRef = doc(db, "cuentas", selectedCuentaId);
        const movementRef = doc(collection(db, "movimientos"));
        const creditResult = await runTransaction(db, async (transaction) => {
          const accountSnapshot = await transaction.get(accountRef);
          if (!accountSnapshot.exists()) throw new Error("CREDIT_ACCOUNT_NOT_FOUND");

          const account = accountSnapshot.data();
          if (account.usuarioId !== user.uid || account.tipoCuenta !== "credito") {
            throw new Error("CREDIT_ACCOUNT_INVALID");
          }
          const creditChanges = applyCreditPurchase(account, valor);
          const statementDates = getCreditStatementForPurchase(account, fechaHora);
          if (!statementDates) throw new Error("CREDIT_STATEMENT_DATES_UNAVAILABLE");
          const startDate = getLocalDateString(statementDates.startDate);
          const cutoffDate = getLocalDateString(statementDates.cutoffDate);
          const paymentDate = getLocalDateString(statementDates.paymentDate);
          const obligationId = `tarjeta-${selectedCuentaId}-${cutoffDate}`;
          const obligationRef = doc(db, "obligaciones", obligationId);
          const obligationSnapshot = await transaction.get(obligationRef);
          const previousObligation = obligationSnapshot.exists() ? obligationSnapshot.data() : null;
          if (previousObligation && (
            previousObligation.usuarioId !== user.uid ||
            previousObligation.tarjetaId !== selectedCuentaId
          )) {
            throw new Error("CREDIT_OBLIGATION_CONFLICT");
          }
          const totalStatement = Number(previousObligation?.valor || 0) + valor;
          const remainingStatement =
            Number(previousObligation?.montoPendiente ?? previousObligation?.valor ?? 0) + valor;

          transaction.update(accountRef, {
            ...creditChanges,
            ultimaActualizacion: serverTimestamp(),
          });
          transaction.set(obligationRef, {
            usuarioId: user.uid,
            tipo: "pago_tarjeta",
            nombre: `PAGO TARJETA ${account.nombre || account.banco || ""}`.trim(),
            tarjetaId: selectedCuentaId,
            tarjetaNombre: account.nombre || "",
            tarjetaBanco: account.banco || "",
            cuentaNombre: `${account.banco || ""} · ${account.nombre || ""}`.trim(),
            fechaInicioCiclo: startDate,
            fechaCorte: cutoffDate,
            fechaProximoPago: paymentDate,
            diaVencimiento: Number(paymentDate.slice(-2)),
            frecuencia: "mensual",
            valor: totalStatement,
            montoPendiente: remainingStatement,
            activa: remainingStatement > 0,
            anulada: false,
            ...(previousObligation?.fechaCreacion ? {} : { fechaCreacion: serverTimestamp() }),
            ultimaActualizacion: serverTimestamp(),
          });
          transaction.set(movementRef, {
            userId: user.uid,
            usuarioId: user.uid,
            cuentaId: selectedCuentaId,
            cuentaBanco: account.banco || "",
            cuentaNombre: account.nombre || "",
            valor,
            establecimiento,
            tags: finalTags,
            tipo: "credito_compra",
            origen: "tarjeta_credito",
            obligacionId: obligationId,
            fechaCorteTarjeta: cutoffDate,
            fechaLimitePagoTarjeta: paymentDate,
            fechaHora,
            fechaCreacion: serverTimestamp(),
          });

          return {
            available: creditChanges.saldo,
            debt: creditChanges.deudaActual,
            obligation: {
              id: obligationId,
              usuarioId: user.uid,
              tipo: "pago_tarjeta",
              nombre: `PAGO TARJETA ${account.nombre || account.banco || ""}`.trim(),
              tarjetaId: selectedCuentaId,
              tarjetaNombre: account.nombre || "",
              tarjetaBanco: account.banco || "",
              cuentaNombre: `${account.banco || ""} · ${account.nombre || ""}`.trim(),
              fechaInicioCiclo: startDate,
              fechaCorte: cutoffDate,
              fechaProximoPago: paymentDate,
              diaVencimiento: Number(paymentDate.slice(-2)),
              frecuencia: "mensual",
              valor: totalStatement,
              montoPendiente: remainingStatement,
              activa: remainingStatement > 0,
              anulada: false,
            },
          };
        });

        setAccounts((current) => current.map((account) => account.id === selectedCuentaId
          ? { ...account, saldo: creditResult.available, deudaActual: creditResult.debt }
          : account));
        setObligations((current) => [
          ...current.filter((item) => item.id !== creditResult.obligation.id),
          creditResult.obligation,
        ].sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago))));
        setObligationPaymentAmounts((current) => ({
          ...current,
          [creditResult.obligation.id]: formatMoneyInput(String(creditResult.obligation.montoPendiente)),
        }));
        setHistorial((current) => [...current, {
          id: Date.now().toString(),
          establecimiento,
          valor,
          tags: finalTags,
        }]);
        showToast("Compra registrada con tarjeta de crédito", "success");
        resetForm();
        return;
      }

      const cuentaRef = doc(db, "cuentas", selectedCuentaId);
      await updateDoc(cuentaRef, {
        saldo: cuentaSeleccionada.saldo - valor,
        ultimaActualizacion: serverTimestamp(),
      });

      await addDoc(collection(db, "movimientos"), {
        userId: user.uid,
        cuentaId: selectedCuentaId,
        cuentaBanco: cuentaSeleccionada.banco,
        cuentaNombre: cuentaSeleccionada.nombre,
        valor,
        establecimiento,
        fechaHora,
        tags: finalTags,
        fechaCreacion: serverTimestamp(),
      });

      // Actualizar estado local de la cuenta para reflejar el nuevo saldo
      setAccounts((prev) =>
        prev.map((cuenta) =>
          cuenta.id === selectedCuentaId
            ? { ...cuenta, saldo: cuenta.saldo - valor }
            : cuenta
        )
      );

      // Actualizar historial local
      setHistorial((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          establecimiento,
          valor,
          tags: finalTags,
        },
      ]);

      showToast("Movimiento registrado correctamente", "success");
      resetForm();
      // Mantener modal abierto: no llamar a onClose()
    } catch (error) {
      console.error("Error guardando movimiento:", error);
      showToast(error.message === "CREDIT_LIMIT_EXCEEDED"
        ? "La compra supera el cupo disponible de la tarjeta"
        : error.message === "CREDIT_STATEMENT_DATES_UNAVAILABLE"
        ? "Configura las fechas de corte y pago de la tarjeta"
        : error.message === "CREDIT_OBLIGATION_CONFLICT"
        ? "No se pudo asociar la compra al extracto de esta tarjeta"
        : "No se pudo crear el movimiento", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="mov-page">
      {loading && <Loading message="Registrando pago..." />}
      <div className="mov-panel">

        {/* HEADER */}
        <div className="mov-header">
          <div className="mov-header-text">
            <h2>{mode === "pago" ? "Registrar pago" : mode === "avance" ? "Registrar avance" : "Crear presupuesto"}</h2>
            <p>
              {mode === "pago"
                ? "Llena los datos de la compra y pulsa Pagar."
                : mode === "avance"
                ? "Registra un avance con tarjeta; el cargo configurado se suma al valor y se difiere al máximo de cuotas."
                : "Reserva una parte de tu saldo y decide después cuándo aceptarla."}
            </p>
          </div>
          <button className="mov-close" onClick={onClose}>Cerrar</button>
        </div>

        <div className="mov-mode-switch" role="tablist" aria-label="Tipo de movimiento">
          <button
            type="button"
            className={mode === "pago" ? "mov-mode-btn mov-mode-btn--active" : "mov-mode-btn"}
            onClick={() => changeMode("pago")}
          >
            Pagar ahora
          </button>
          <button
            type="button"
            className={mode === "avance" ? "mov-mode-btn mov-mode-btn--active" : "mov-mode-btn"}
            onClick={() => changeMode("avance")}
          >
            Avance de tarjeta
          </button>
          <button
            type="button"
            className={mode === "presupuesto" ? "mov-mode-btn mov-mode-btn--active" : "mov-mode-btn"}
            onClick={() => changeMode("presupuesto")}
          >
            Crear presupuesto
          </button>
        </div>

        {/* FORM */}
        <form className="mov-form" onSubmit={handleSubmit}>

          {/* Cuenta */}
          <div className="mov-field">
            <span className="mov-label">Cuenta</span>
            <div className="mov-account-picker" role="radiogroup" aria-label="Selecciona una cuenta">
              {accounts
                .filter((cuenta) => mode === "pago"
                  ? ["gastos", "credito"].includes(cuenta.tipoCuenta || "gastos")
                  : mode === "avance"
                  ? cuenta.tipoCuenta === "credito"
                  : (cuenta.tipoCuenta || "gastos") === "gastos")
                .map((cuenta) => {
                  const isSelected = selectedCuentaId === cuenta.id;
                  const creditDates = cuenta.tipoCuenta === "credito"
                    ? getCreditStatementDates(cuenta)
                    : null;
                  return (
                    <button
                      className={`mov-account-option${isSelected ? " mov-account-option--selected" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      key={cuenta.id}
                      onClick={() => setSelectedCuentaId(cuenta.id)}
                    >
                      <img src={getAccountCardImage(cuenta)} alt="" />
                      <span className="mov-account-option__details">
                        <span>{cuenta.banco}</span>
                        <strong>{cuenta.nombre}</strong>
                        <span className="mov-account-option__metrics">
                          {cuenta.tipoCuenta === "credito" ? (
                            <>
                              <span className="mov-account-option__data-row">
                                <small>Cupo disponible</small>
                                <strong>${formatMoney(cuenta.saldo)}</strong>
                              </span>
                              <span className="mov-account-option__data-row">
                                <small>Deuda actual</small>
                                <strong>${formatMoney(cuenta.deudaActual)}</strong>
                              </span>
                            </>
                          ) : (
                            <span className="mov-account-option__data-row">
                              <small>Saldo</small>
                              <strong>${formatMoney(cuenta.saldo)}</strong>
                            </span>
                          )}
                        </span>
                        {creditDates && (
                          <span className="mov-account-option__billing">
                            <span className="mov-account-option__data-row">
                              <small>Fecha de corte</small>
                              <strong>{creditDates.cutoffDate.toLocaleDateString("es-CO", { day: "numeric", month: "long" })}</strong>
                            </span>
                            <span className="mov-account-option__data-row">
                              <small>Límite de pago</small>
                              <strong>{creditDates.paymentDate.toLocaleDateString("es-CO", { day: "numeric", month: "long" })}</strong>
                            </span>
                          </span>
                        )}
                      </span>
                      <span className="mov-account-option__check" aria-hidden="true">
                        {isSelected && <Check size={17} strokeWidth={2.5} />}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Valor */}
          <div className="mov-field">
            <label className="mov-label" htmlFor="movement-value">
              {mode === "avance" ? "Valor del avance" : "Valor"}
            </label>
            <input
              id="movement-value"
              className="mov-input"
              name="valor"
              type="text"
              inputMode="numeric"
              value={formValues.valor}
              onChange={handleChange}
              placeholder="0"
            />
          </div>

          {mode === "avance" && (
            <div className="mov-field">
              <span className="mov-label">Detalle del avance</span>
              <div className="mov-account-option__metrics">
                <span className="mov-account-option__data-row">
                  <small>Cargo por avance</small>
                  <strong>${formatMoney(selectedAccount?.cargoAvance || 0)}</strong>
                </span>
                <span className="mov-account-option__data-row">
                  <small>Máximo de cuotas</small>
                  <strong>{selectedAccount?.maximoCuotasAvance || "Sin configurar"}</strong>
                </span>
                <span className="mov-account-option__data-row">
                  <small>Total cargado a la tarjeta</small>
                  <strong>
                    ${formatMoney(Number(formValues.valor.replace(/\./g, "") || 0) + Number(selectedAccount?.cargoAvance || 0))}
                  </strong>
                </span>
              </div>
            </div>
          )}

          {(mode === "pago" || mode === "avance") && (
            <div className="mov-field">
              <label className="mov-checkbox-label" htmlFor="usePreviousDate">
                <input
                  id="usePreviousDate"
                  type="checkbox"
                  checked={usePreviousDate}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setUsePreviousDate(checked);
                    if (checked && !formValues.fechaHora) {
                      setFormValues((prev) => ({
                        ...prev,
                        fechaHora: getCurrentDateTimeValue(),
                      }));
                    }
                  }}
                />
                <span>
                  {mode === "avance" ? "Registrar con una fecha anterior" : "Registrar como pago anterior"}
                </span>
              </label>

              {usePreviousDate && (
                <>
                  <label className="mov-label" htmlFor="fechaHora">
                    {mode === "avance" ? "Fecha y hora del avance" : "Fecha y hora del pago"}
                  </label>
                  <input
                    id="fechaHora"
                    className="mov-input"
                    name="fechaHora"
                    type="datetime-local"
                    max={getCurrentDateTimeValue()}
                    value={formValues.fechaHora}
                    onChange={handleChange}
                  />
                </>
              )}
            </div>
          )}

          {mode === "presupuesto" && (
            <div className="mov-field">
              <label className="mov-label" htmlFor="fechaProgramada">Fecha programada</label>
              <input
                id="fechaProgramada"
                className="mov-input"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={budgetForm.fechaProgramada}
                onChange={(event) => setBudgetForm({ fechaProgramada: event.target.value })}
              />
            </div>
          )}

          {/* Establecimiento */}
          <div className="mov-field mov-field--full">
            <span className="mov-label">Establecimiento</span>
            <input
              className="mov-input"
              name="establecimiento"
              type="text"
              value={formValues.establecimiento}
              onChange={handleChange}
              placeholder={mode === "avance" ? "Cajero o descripción del avance" : "Nombre del comercio"}
            />

            {/* Sugerencia */}
            {sugerencia && (
              <div className="mov-suggestion">
                <div className="mov-suggestion-header">
                  <strong>🏪 {sugerencia.establecimiento}</strong>
                </div>
                <div className="mov-suggestion-tags">
                  <span className="mov-suggestion-label">Tags sugeridos:</span>
                  {sugerencia.tags.map((tag) => (
                    <span key={tag} className="mov-tag-chip">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mov-suggestion-confidence">
                  📈 Confianza: {sugerencia.confianza}%
                </div>
                <button
                  type="button"
                  className="mov-apply-suggestion"
                  onClick={() => {
                    setFormValues((prev) => ({
                      ...prev,
                      establecimiento: sugerencia.establecimiento,
                    }));
                    setTags(normalizeTags(sugerencia.tags));
                    setTagInput("");
                  }}
                >
                  ✓ Aplicar sugerencia
                </button>
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="mov-field mov-field--full">
            <span className="mov-label">Tags</span>
            <div
              className="mov-tags-wrapper"
              onClick={(e) => e.currentTarget.querySelector("input").focus()}
            >
              {tags.map((tag, i) => (
                <span key={i} className="mov-tag-chip">
                  {tag}
                  <button
                    type="button"
                    className="mov-tag-chip__remove"
                    onClick={() => removeTag(i)}
                    aria-label={`Eliminar ${tag}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <input
                className="mov-tags-input"
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value.toUpperCase())}
                onKeyDown={handleTagKeyDown}
                placeholder={tags.length === 0 ? "Ej. comida, café… (espacio para agregar)" : ""}
              />
            </div>
          </div>

          <button className="mov-submit" type="submit">
            {mode === "pago" ? "Pagar" : mode === "avance" ? "Registrar avance" : "Guardar presupuesto"}
          </button>
        </form>

        {budgets.length > 0 && (
          <section className="mov-budgets" aria-labelledby="budgets-title">
            <div className="mov-budgets__heading">
              <div>
                <h3 id="budgets-title">Presupuestos pendientes</h3>
                <p>El saldo se descuenta únicamente al aceptar.</p>
              </div>
              <span className="mov-budgets__count">{budgets.length}</span>
            </div>
            <div className="mov-budgets__list">
              {budgets.map((budget) => (
                <article className="mov-budget" key={budget.id}>
                  <div>
                    <strong>{budget.establecimiento}</strong>
                    <span>
                      ${formatMoney(budget.valor)} · {budget.cuentaNombre} · {budget.fechaProgramada}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="mov-budget__accept"
                    onClick={() => handleAcceptBudget(budget)}
                  >
                    Aceptar y pagar
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {(pendingObligations.length > 0 || paidObligationsThisMonth.length > 0) && (
          <section className="mov-budgets mov-obligations" aria-labelledby="obligations-title">
            <div className="mov-budgets__heading">
              <div>
                <h3 id="obligations-title">Obligaciones · pagar después</h3>
                <p>Al pagar, se registra el movimiento y se programa el siguiente periodo.</p>
              </div>
              <span className="mov-budgets__count">{pendingObligations.length}</span>
            </div>
            {pendingObligations.length > 0 && (
              <div className="mov-budgets__list">
                {pendingObligations.map((obligation) => (
                  <article className="mov-budget" key={`pending-${obligation.id}`}>
                    <div>
                      <strong>{obligation.nombre}</strong>
                      <span>
                        ${formatMoney(obligation.tipo === "pago_tarjeta"
                          ? obligation.montoPendiente ?? obligation.valor
                          : obligation.valor)}
                        {" · "}{obligation.tipo === "pago_tarjeta"
                          ? `${obligation.tarjetaBanco} · ${obligation.tarjetaNombre} · Corte ${formatObligationDate(obligation.fechaCorte)}`
                          : `${obligation.cuentaNombre} · ${formatObligationSchedule(obligation)}`}
                        {" · Próximo: "}{formatObligationDate(obligation.fechaProximoPago)}
                      </span>
                      {obligation.deudaId && (
                        <span>Saldo de la deuda pendiente: ${formatMoney(obligation.deudaRestante)}</span>
                      )}
                    </div>
                    <div className="mov-obligation-payment">
                      <label>
                        {obligation.tipo === "pago_tarjeta" ? "Valor a abonar" : "Valor realmente pagado"}
                        <input
                          type="text"
                          inputMode="numeric"
                          required
                          aria-label={`Valor realmente pagado de ${obligation.nombre}`}
                          value={obligationPaymentAmounts[obligation.id] ?? ""}
                          placeholder={obligation.tipo === "pago_tarjeta"
                            ? `Máximo $${formatMoney(obligation.montoPendiente ?? obligation.valor)}`
                            : obligation.deudaId
                              ? `Máximo $${formatMoney(obligation.deudaRestante)}`
                              : ""}
                          onChange={(event) => setObligationPaymentAmounts((current) => ({
                            ...current,
                            [obligation.id]: formatMoneyInput(event.target.value),
                          }))}
                        />
                      </label>
                      {obligation.tipo === "pago_tarjeta" && (
                        <label>
                          Pagar desde
                          <select
                            value={obligationPaymentAccounts[obligation.id] || ""}
                            onChange={(event) => setObligationPaymentAccounts((current) => ({
                              ...current,
                              [obligation.id]: event.target.value,
                            }))}
                          >
                            <option value="">Selecciona cuenta</option>
                            {accounts
                              .filter((account) => (account.tipoCuenta || "gastos") === "gastos")
                              .map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.nombre} · ${formatMoney(account.saldo)}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      <button
                        type="button"
                        className="mov-budget__accept"
                        disabled={loading}
                        onClick={() => handlePayObligation(
                          obligation,
                          Number((obligationPaymentAmounts[obligation.id] || "").replace(/\./g, ""))
                        )}
                      >
                        {obligation.tipo === "pago_tarjeta" ? "Abonar tarjeta" : "Pagar obligación"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {paidObligationsThisMonth.length > 0 && (
              <div className="mov-obligations__paid">
                <h4>Pagadas este mes</h4>
                <div className="mov-budgets__list">
                  {paidObligationsThisMonth.map((obligation) => (
                    <article className="mov-budget mov-budget--paid" key={`paid-${obligation.id}`}>
                      <div>
                        <strong>{obligation.nombre}</strong>
                        <span>
                          ${formatMoney(obligation.valor)} · {obligation.cuentaNombre} · Periodo pagado: {formatObligationDate(obligation.fechaUltimoPeriodoPagado)}
                        </span>
                      </div>
                      <span className="mov-obligations__paid-status">Pagada</span>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {recurringIncomes.length > 0 && (
          <section className="mov-budgets mov-recurring-incomes" aria-labelledby="recurring-incomes-title">
            <div className="mov-budgets__heading">
              <div>
                <h3 id="recurring-incomes-title">Ingresos mensuales · aceptar</h3>
                <p>Ajusta el valor hacia arriba o abajo según lo que recibiste este mes.</p>
              </div>
              <span className="mov-budgets__count">{recurringIncomes.length}</span>
            </div>
            <div className="mov-budgets__list">
              {recurringIncomes.map((income) => (
                <article className="mov-budget" key={income.id}>
                  <div>
                    <strong>{income.nombre}</strong>
                    <span>
                      Base: ${formatMoney(income.valor)} · {income.cuentaNombre} · Próximo: {formatObligationDate(income.fechaProximoPago)}
                    </span>
                    <span>
                      Total a recibir: {
                        Number.isSafeInteger(Number(income.valor) + parseSignedMoney(recurringIncomeAmounts[income.id] ?? "0")) &&
                        Number(income.valor) + parseSignedMoney(recurringIncomeAmounts[income.id] ?? "0") > 0
                          ? `$${formatMoney(Number(income.valor) + parseSignedMoney(recurringIncomeAmounts[income.id] ?? "0"))}`
                          : "—"
                      }
                    </span>
                  </div>
                  <div className="mov-obligation-payment">
                    <label>
                      Ajuste (+ / −)
                      <input
                        type="text"
                        inputMode="text"
                        required
                        aria-label={`Ajuste al ingreso esperado de ${income.nombre}`}
                        value={recurringIncomeAmounts[income.id] ?? ""}
                        onChange={(event) => setRecurringIncomeAmounts((current) => ({
                          ...current,
                          [income.id]: formatSignedMoneyInput(event.target.value),
                        }))}
                      />
                    </label>
                    <button
                      type="button"
                      className="mov-budget__accept"
                      disabled={loading || !Number.isSafeInteger(
                        Number(income.valor) + parseSignedMoney(recurringIncomeAmounts[income.id] ?? "0")
                      ) || Number(income.valor) + parseSignedMoney(recurringIncomeAmounts[income.id] ?? "0") <= 0}
                      onClick={() => handleAcceptRecurringIncome(
                        income,
                        Number(income.valor) + parseSignedMoney(recurringIncomeAmounts[income.id] ?? "0")
                      )}
                    >
                      Aceptar ingreso
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
};

export default Movimientos;