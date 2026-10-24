import React, { useEffect, useState } from "react";
import { auth, db } from "../../../server/api";
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  runTransaction,
} from "firebase/firestore";
import Loading from "../../../resources/loading/loading";
import { showToast } from "../../../resources/toastcontainer/ToastContainer";
import {
  applyCreditPayment,
  applyCreditPurchase,
  getCreditInstallmentSchedule,
} from "../../cuentas/creditAccountUtils";
import { getLocalDateString } from "../obligaciones/obligationUtils";
import Filtro from "./filtro";
import "./vermovimientos.css";

/* ─── Utilidades ─────────────────────────────────────────── */

const formatDateTime = (value) => {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  return date.toLocaleString("es-ES", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getNumber = (value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.replace(/\./g, "")) || 0;
  return 0;
};

const formatMoney = (value) => {
  const num = Number(value);
  const abs = String(Math.abs(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return num < 0 ? `-${abs}` : abs;
};

/**
 * Un movimiento es ingreso si tiene descripción, NO tiene establecimiento
 * y su tipo no es "pago_deuda".
 * Los movimientos generales (veslosmovimientos) usan `usuarioId` y no
 * tienen `establecimiento`, por eso la presencia de `descripcion` los
 * distingue como ingresos; si tienen `establecimiento` son egresos normales.
 */
const isIngreso = (m, accountId) =>
  (m.tipo === "transferencia" && m.cuentaDestinoId === accountId) ||
  (m.descripcion && !m.establecimiento && m.tipo !== "pago_deuda" && m.tipo !== "transferencia");

const getMovementAmount = (movement, accountId) =>
  movement.tipo === "transferencia" && movement.cuentaDestinoId === accountId
    ? Number(movement.valorDestino ?? movement.valor)
    : Number(movement.valor);

const isPagoDeuda = (m) => m.tipo === "pago_deuda";

const getMovementDate = (movimiento) => {
  const value = movimiento.fechaHora || movimiento.fechaCreacion;
  if (!value) return null;
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value) => {
  const date = value instanceof Date ? value : getMovementDate({ fechaHora: value });
  return date
    ? date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "-";
};

/* ─── Componente ─────────────────────────────────────────── */

const VerMovimientos = ({ isOpen, onClose }) => {
  const [accounts, setAccounts] = useState([]);
  const [selectedCuentaId, setSelectedCuentaId] = useState("");

  // movimientos con userId (vermovimientos original: pagos de deudas, etc.)
  const [movementsById, setMovementsById] = useState([]);
  // movimientos con usuarioId (veslosmovimientos: movimientos generales)
  const [movementsByUsuarioId, setMovementsByUsuarioId] = useState([]);

  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(false);

  // Paginación y filtros
  const [currentPage, setCurrentPage] = useState(1);
  const [filterPeriod, setFilterPeriod] = useState("todos");
  const [filterType, setFilterType] = useState("todos");
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedConcepts, setSelectedConcepts] = useState([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const itemsPerPage = 10;

  /* ── Cargar cuentas al abrir ── */
  useEffect(() => {
    if (!isOpen) return;

    const fetchAccounts = async () => {
      const user = auth.currentUser;
      if (!user) return;
      setLoading(true);
      try {
        const snap = await getDocs(
          query(collection(db, "cuentas"), where("usuarioId", "==", user.uid))
        );
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort(
            (a, b) =>
              (b.fechaCreacion?.toMillis?.() ?? 0) -
              (a.fechaCreacion?.toMillis?.() ?? 0)
          );
        setAccounts(docs);
        const defaultAccount = docs.find((account) => account.esDefault);
        setSelectedCuentaId(defaultAccount?.id || docs[0]?.id || "");
      } catch {
        showToast("No se pudieron cargar las cuentas", "error");
      } finally {
        setLoading(false);
      }
    };

    // Limpiar estado anterior al abrir
    setAccounts([]);
    setMovementsById([]);
    setMovementsByUsuarioId([]);
    setDebts([]);
    setSelectedCuentaId("");
    setSelectedTags([]);
    setSelectedConcepts([]);
    setIsFilterOpen(false);
    fetchAccounts();
  }, [isOpen]);

  /* ── Cargar movimientos y deudas al cambiar cuenta ── */
  useEffect(() => {
    if (!isOpen || !selectedCuentaId) {
      setMovementsById([]);
      setMovementsByUsuarioId([]);
      setDebts([]);
      return;
    }

    const fetchData = async () => {
      const user = auth.currentUser;
      if (!user) return;
      setLoading(true);
      try {
        // 1) Movimientos indexados por `userId` (pagos de deudas, egresos especiales)
        const snapById = await getDocs(
          query(
            collection(db, "movimientos"),
            where("userId", "==", user.uid)
          )
        );
        const docsById = snapById.docs
          .map((d) => ({ id: d.id, ...d.data(), _source: "userId" }))
          .filter((movement) => (
            movement.cuentaId === selectedCuentaId ||
            movement.cuentaDestinoId === selectedCuentaId
          ))
          .sort(
            (a, b) =>
              (b.fechaCreacion?.toMillis?.() ?? 0) -
              (a.fechaCreacion?.toMillis?.() ?? 0)
          );
        setMovementsById(docsById);

        // 2) Movimientos indexados por `usuarioId` (movimientos generales)
        const snapByUsuarioId = await getDocs(
          query(
            collection(db, "movimientos"),
            where("usuarioId", "==", user.uid)
          )
        );
        const docsByUsuarioId = snapByUsuarioId.docs
          .map((d) => ({ id: d.id, ...d.data(), _source: "usuarioId" }))
          .filter((movement) => (
            movement.cuentaId === selectedCuentaId ||
            movement.cuentaDestinoId === selectedCuentaId
          ))
          .sort(
            (a, b) =>
              (b.fechaCreacion?.toMillis?.() ?? 0) -
              (a.fechaCreacion?.toMillis?.() ?? 0)
          );
        setMovementsByUsuarioId(docsByUsuarioId);

        // 3) Deudas pendientes del usuario
        const debtSnap = await getDocs(
          query(collection(db, "deudas"), where("usuarioId", "==", user.uid))
        );
        const debtDocs = debtSnap.docs
          .map((d) => ({ id: d.id, ...d.data(), type: "deuda" }))
          .filter((d) => !(d.pagada || (d.montoRestante ?? d.monto) <= 0))
          .sort(
            (a, b) =>
              (b.fechaCreacion?.toMillis?.() ?? 0) -
              (a.fechaCreacion?.toMillis?.() ?? 0)
          );
        setDebts(debtDocs);
      } catch {
        showToast("No se pudieron cargar los datos", "error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen, selectedCuentaId]);

  /* ── Fusionar y deduplicar movimientos ── */
  const allMovements = React.useMemo(() => {
    const seen = new Set();
    return [...movementsById, ...movementsByUsuarioId]
      .filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      })
      .sort(
        (a, b) =>
          (b.fechaCreacion?.toMillis?.() ?? 0) -
          (a.fechaCreacion?.toMillis?.() ?? 0)
      );
  }, [movementsById, movementsByUsuarioId]);

  /* ── Filtrar por período ── */
  const isWithinPeriod = (movimiento, period) => {
    const now = new Date();
    const movDate = movimiento.fechaHora?.toDate
      ? movimiento.fechaHora.toDate()
      : new Date(movimiento.fechaHora);

    if (period === "todos") return true;

    const diffMs = now - movDate;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    switch (period) {
      case "semanal":
        return diffDays <= 7;
      case "quincenal":
        return diffDays <= 15;
      case "mensual":
        return diffDays <= 30;
      default:
        return true;
    }
  };

  const availableTags = React.useMemo(() => {
    const tags = new Map();
    allMovements.forEach((movimiento) => {
      (movimiento.tags || []).forEach((tag) => {
        const normalizedTag = String(tag).trim();
        if (normalizedTag) tags.set(normalizedTag.toLowerCase(), normalizedTag);
      });
    });
    return [...tags.values()].sort((a, b) => a.localeCompare(b, "es"));
  }, [allMovements]);

  const availableConcepts = React.useMemo(() => {
    const concepts = new Map();
    allMovements.forEach((movimiento) => {
      [movimiento.nombreEstablecimiento, movimiento.establecimiento || movimiento.descripcion]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .forEach((concept) => concepts.set(concept.toLowerCase(), concept));
    });
    return [...concepts.values()].sort((a, b) => a.localeCompare(b, "es"));
  }, [allMovements]);

  /* ── Movimientos filtrados y paginados ── */
  const filteredMovements = React.useMemo(() => {
    return allMovements.filter(
      (m) =>
        isWithinPeriod(m, filterPeriod) &&
        (filterType === "todos" ||
          (filterType === "ingreso" && isIngreso(m, selectedCuentaId)) ||
          (filterType === "egreso" && !isIngreso(m, selectedCuentaId) && !isPagoDeuda(m)) ||
          (filterType === "deuda" && isPagoDeuda(m))) &&
        (selectedTags.length === 0 || (m.tags || []).some((tag) =>
          selectedTags.some(
            (selectedTag) =>
              selectedTag.toLowerCase() === String(tag).trim().toLowerCase()
          )
        )) &&
        (selectedConcepts.length === 0 || selectedConcepts.includes(
          String(m.nombreEstablecimiento || m.establecimiento || m.descripcion || "").trim()
        ) || selectedConcepts.includes(String(m.establecimiento || m.descripcion || "").trim()))
    );
  }, [allMovements, filterPeriod, filterType, selectedTags, selectedConcepts, selectedCuentaId]);

  /* ── Paginación ── */
  const totalPages = Math.ceil(filteredMovements.length / itemsPerPage);
  const validPage = Math.min(currentPage, Math.max(1, totalPages));
  const startIdx = (validPage - 1) * itemsPerPage;
  const paginatedMovements = filteredMovements.slice(
    startIdx,
    startIdx + itemsPerPage
  );

  /* ── Resetear página al cambiar filtros ── */
  React.useEffect(() => {
    setCurrentPage(1);
  }, [filterPeriod, filterType, selectedTags, selectedConcepts, selectedCuentaId]);

  /* ── Cálculos resumen ── */
  const cuentaActual = accounts.find((c) => c.id === selectedCuentaId);

  const totalEgresos = filteredMovements.reduce(
    (acc, m) => acc + (!isIngreso(m, selectedCuentaId) ? getMovementAmount(m, selectedCuentaId) : 0),
    0
  );
  const totalIngresos = filteredMovements.reduce(
    (acc, m) => acc + (isIngreso(m, selectedCuentaId) ? getMovementAmount(m, selectedCuentaId) : 0),
    0
  );
  const cantMovimientos = filteredMovements.length;
  const totalDeudas = debts.reduce(
    (acc, d) => acc + getNumber(d.montoRestante ?? d.monto),
    0
  );
  const totalTagGastado = filteredMovements.reduce(
    (acc, movimiento) => acc + (!isIngreso(movimiento, selectedCuentaId)
      ? getMovementAmount(movimiento, selectedCuentaId)
      : 0),
    0
  );
  const movementDates = filteredMovements
    .map(getMovementDate)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const firstMovementDate = movementDates[0];
  const lastMovementDate = movementDates[movementDates.length - 1];

  /* ── Eliminar movimiento ── */
  const handleDeleteMovimiento = async (movimiento) => {
    const isCardPayment = movimiento.tipo === "pago_tarjeta";
    const isCreditPurchase = movimiento.tipo === "credito_compra";
    const isCreditAdvance = movimiento.tipo === "credito_avance";
    const isTransfer = movimiento.tipo === "transferencia" || isCardPayment;
    const isSavingsLiquidation = movimiento.origen === "liquidacion_alcancia";
    const isIncomeMovement = isIngreso(movimiento, selectedCuentaId);
    const isExternalTransfer = isTransfer && movimiento.tipoTransferencia === "externa";
    const confirmDelete = window.confirm(
      isExternalTransfer
        ? `¿Eliminar el envío a ${movimiento.destinatarioNombre}? Se devolverán $${formatMoney(movimiento.valor)} al origen.`
        : isCardPayment
        ? `¿Eliminar este abono? Se devolverán $${formatMoney(movimiento.valor)} al origen y la deuda de la tarjeta aumentará.`
        : isSavingsLiquidation
        ? `¿Revertir esta liquidación? Se devolverán $${formatMoney(movimiento.valor)} a la alcancía y se descontarán $${formatMoney(movimiento.valorDestino)} del destino.`
        : isTransfer
        ? `¿Eliminar esta transferencia? Se devolverán $${formatMoney(movimiento.valor)} al origen y se descontarán del destino.`
        : isIncomeMovement
        ? `¿Eliminar este ingreso? Se descontarán $${formatMoney(movimiento.valor)} de la cuenta.`
        : isCreditAdvance
        ? `¿Eliminar este avance? Se devolverán $${formatMoney(movimiento.valor)} al cupo de la tarjeta.`
        : isCreditPurchase && Number(movimiento.cuotas || 1) === 1
        ? `¿Eliminar esta compra? Se descontará del extracto de la tarjeta y se devolverá $${formatMoney(movimiento.valor)} al cupo.`
        : movimiento.tipo === "credito_compra" && movimiento.deudaId
        ? `¿Eliminar esta compra financiada? Se borrarán la deuda y su obligación, se revertirán sus pagos registrados y se devolverá el valor a la tarjeta.`
        : `¿Estás seguro de que deseas eliminar este movimiento? Se devolverán $${formatMoney(movimiento.valor)} a la cuenta.`
    );
    if (!confirmDelete) return;

    setLoading(true);
    try {
      // 1. Obtener la cuenta actual del estado local
      const cuentaActual = accounts.find((c) => c.id === (movimiento.cuentaId || selectedCuentaId));
      if (!cuentaActual) {
        showToast("No se encontró la cuenta", "error");
        return;
      }

      if (isCreditPurchase || isCreditAdvance) {
        const accountId = movimiento.cuentaId || selectedCuentaId;
        const accountRef = doc(db, "cuentas", accountId);
        if (isCreditPurchase && movimiento.deudaId) {
          const userId = auth.currentUser?.uid;
          if (!userId || !movimiento.id || !accountId) {
            throw new Error("CREDIT_DEBT_UNAVAILABLE");
          }
          const debtRef = doc(db, "deudas", movimiento.deudaId);
          const linkedPaymentsByUserIdQuery = query(
            collection(db, "movimientos"),
            where("deudaId", "==", movimiento.deudaId),
            where("userId", "==", userId)
          );
          const linkedPaymentsByUsuarioIdQuery = query(
            collection(db, "movimientos"),
            where("deudaId", "==", movimiento.deudaId),
            where("usuarioId", "==", userId)
          );
          const [
            linkedPaymentsByUserIdSnapshot,
            linkedPaymentsByUsuarioIdSnapshot,
          ] = await Promise.all([
            getDocs(linkedPaymentsByUserIdQuery),
            getDocs(linkedPaymentsByUsuarioIdQuery),
          ]);
          let updatedAccounts = [];
          let deletedPaymentIds = [];

          await runTransaction(db, async (transaction) => {
            const [accountSnapshot, debtSnapshot] = await Promise.all([
              transaction.get(accountRef),
              transaction.get(debtRef),
            ]);
            if (!accountSnapshot.exists() || !debtSnapshot.exists()) {
              throw new Error("CREDIT_DEBT_UNAVAILABLE");
            }
            const debt = debtSnapshot.data();
            const obligationId = movimiento.obligacionId || debt.obligacionId;
            if (!obligationId) throw new Error("CREDIT_OBLIGATION_UNAVAILABLE");
            const obligationRef = doc(db, "obligaciones", obligationId);
            const obligationSnapshot = await transaction.get(obligationRef);
            if (accountSnapshot.data().usuarioId !== userId ||
              accountSnapshot.data().tipoCuenta !== "credito") {
              throw new Error("CREDIT_PAYMENT_ACCOUNT_UNAVAILABLE");
            }
            if (debt.usuarioId !== userId ||
              debt.movimientoId !== movimiento.id) {
              throw new Error("CREDIT_DEBT_UNAVAILABLE");
            }
            if (!obligationSnapshot.exists() ||
              obligationSnapshot.data().deudaId !== movimiento.deudaId) {
              throw new Error("CREDIT_OBLIGATION_UNAVAILABLE");
            }

            const linkedPaymentDocuments = new Map([
              ...linkedPaymentsByUserIdSnapshot.docs,
              ...linkedPaymentsByUsuarioIdSnapshot.docs,
            ].map((snapshot) => [snapshot.id, snapshot]));
            const linkedPaymentSnapshots = new Map(await Promise.all(
              [...linkedPaymentDocuments.keys()].map(async (id) => {
                const snapshot = await transaction.get(doc(db, "movimientos", id));
                return [id, snapshot];
              })
            ));
            const linkedPayments = [...linkedPaymentSnapshots.values()]
              .filter((snapshot) => snapshot.id !== movimiento.id)
              .filter((snapshot) => snapshot.exists())
              .map((snapshot) => {
                const payment = snapshot.data();
                if ((payment.usuarioId || payment.userId) !== userId) {
                  throw new Error("CREDIT_PAYMENT_ACCOUNT_UNAVAILABLE");
                }
                return { id: snapshot.id, ...payment };
              });
            const installmentSchedule = getCreditInstallmentSchedule(
              accountSnapshot.data(),
              Number(movimiento.valor),
              Number(movimiento.cuotas || 1),
              getMovementDate(movimiento)
            );
            if (!installmentSchedule) throw new Error("CREDIT_STATEMENT_UNAVAILABLE");
            const linkedStatementAmounts = new Map();
            linkedPayments.forEach((payment) => {
              if (!payment.obligacionPagadaId || !payment.obligacionId) return;
              linkedStatementAmounts.set(
                payment.obligacionId,
                (linkedStatementAmounts.get(payment.obligacionId) || 0) + Number(payment.valor || 0)
              );
            });
            installmentSchedule.forEach((installment) => {
              const statementId = `tarjeta-${accountId}-${getLocalDateString(installment.cutoffDate)}`;
              linkedStatementAmounts.set(
                statementId,
                (linkedStatementAmounts.get(statementId) || 0) + installment.amount
              );
            });
            const linkedStatements = [...linkedStatementAmounts.entries()].map(([id, amount]) => ({
              id,
              amount,
              ref: doc(db, "obligaciones", id),
            }));
            const linkedStatementSnapshots = await Promise.all(
              linkedStatements.map(({ ref }) => transaction.get(ref))
            );
            const linkedAccountIds = [...new Set(
              linkedPayments.map((payment) => payment.cuentaId).filter(Boolean)
            )];
            const linkedAccountSnapshots = await Promise.all(linkedAccountIds.map((id) =>
              id === accountId
                ? Promise.resolve(accountSnapshot)
                : transaction.get(doc(db, "cuentas", id))
            ));
            const accountDataById = new Map(linkedAccountIds.map((id, index) => [
              id,
              linkedAccountSnapshots[index].exists()
                ? linkedAccountSnapshots[index].data()
                : null,
            ]));
            accountDataById.set(accountId, accountSnapshot.data());
            const accountChanges = new Map();
            const originalAccount = accountSnapshot.data();
            const purchaseValue = Number(movimiento.valor);
            if (Number(originalAccount.deudaActual || 0) < purchaseValue) {
              throw new Error("CREDIT_PURCHASE_ALREADY_SETTLED");
            }
            accountChanges.set(
              accountId,
              applyCreditPayment(originalAccount, purchaseValue)
            );

            linkedPayments.forEach((payment) => {
              const paymentAccount = accountDataById.get(payment.cuentaId);
              if (!paymentAccount ||
                paymentAccount.usuarioId !== userId) {
                throw new Error("CREDIT_PAYMENT_ACCOUNT_UNAVAILABLE");
              }
              const amount = Number(payment.valor);
              if (!Number.isSafeInteger(amount) || amount <= 0) {
                throw new Error("CREDIT_PAYMENT_INVALID");
              }
              if (paymentAccount.tipoCuenta === "credito") {
                const currentAccount = accountChanges.has(payment.cuentaId)
                  ? { ...paymentAccount, ...accountChanges.get(payment.cuentaId) }
                  : paymentAccount;
                if (Number(currentAccount.deudaActual || 0) < amount) {
                  throw new Error("CREDIT_PURCHASE_ALREADY_SETTLED");
                }
                accountChanges.set(payment.cuentaId, applyCreditPayment(currentAccount, amount));
              } else {
                const currentBalance = Number(paymentAccount.saldo || 0);
                const currentChange = accountChanges.get(payment.cuentaId);
                accountChanges.set(payment.cuentaId, {
                  saldo: Number(currentChange?.saldo ?? currentBalance) + amount,
                });
              }
            });

            accountChanges.forEach((changes, id) => {
              transaction.update(doc(db, "cuentas", id), {
                ...changes,
                ultimaActualizacion: new Date(),
              });
            });
            linkedStatements.forEach((statement, index) => {
              const snapshot = linkedStatementSnapshots[index];
              if (!snapshot.exists()) return;
              const currentStatement = snapshot.data();
              if (currentStatement.usuarioId !== userId ||
                currentStatement.tipo !== "pago_tarjeta") {
                throw new Error("CREDIT_STATEMENT_UNAVAILABLE");
              }
              const value = Math.max(0, Number(currentStatement.valor || 0) - statement.amount);
              const remaining = Math.max(
                0,
                Number(currentStatement.montoPendiente ?? currentStatement.valor ?? 0) -
                  statement.amount
              );
              if (value === 0) {
                transaction.delete(statement.ref);
              } else {
                transaction.update(statement.ref, {
                  valor: value,
                  montoPendiente: remaining,
                  activa: remaining > 0,
                  anulada: remaining <= 0,
                  cuotasCompra: (currentStatement.cuotasCompra || [])
                    .filter((installment) => installment.deudaId !== movimiento.deudaId),
                  ultimaActualizacion: new Date(),
                });
              }
            });
            transaction.delete(debtRef);
            transaction.delete(obligationRef);
            linkedPaymentSnapshots.forEach((snapshot) => transaction.delete(snapshot.ref));
            transaction.delete(doc(db, "movimientos", movimiento.id));

            updatedAccounts = [...accountChanges.entries()].map(([id, changes]) => ({
              id,
              ...changes,
            }));
            deletedPaymentIds = [...linkedPaymentSnapshots.keys()];
          });

          setAccounts((previous) => previous.map((account) => {
            const updated = updatedAccounts.find((item) => item.id === account.id);
            return updated ? { ...account, ...updated } : account;
          }));
          setMovementsById((previous) => previous.filter((item) =>
            item.id !== movimiento.id && !deletedPaymentIds.includes(item.id)
          ));
          setMovementsByUsuarioId((previous) => previous.filter((item) =>
            item.id !== movimiento.id && !deletedPaymentIds.includes(item.id)
          ));
          setDebts((previous) => previous.filter((debt) => debt.id !== movimiento.deudaId));
          showToast("Compra revertida; se eliminaron la deuda y su obligación", "success");
          return;
        }

        if (isCreditPurchase && movimiento.obligacionId) {
          const accountRef = doc(db, "cuentas", movimiento.cuentaId);
          let availableAfter = 0;
          let debtAfter = 0;
          await runTransaction(db, async (transaction) => {
            const accountSnapshot = await transaction.get(accountRef);
            if (!accountSnapshot.exists()) throw new Error("CUENTA_NO_ENCONTRADA");
            const accountData = accountSnapshot.data();
            if (accountData.usuarioId !== (movimiento.usuarioId || movimiento.userId) ||
              accountData.tipoCuenta !== "credito") {
              throw new Error("CREDIT_PAYMENT_ACCOUNT_UNAVAILABLE");
            }
            const purchaseDate = getMovementDate(movimiento);
            const installmentCount = Number(movimiento.cuotas || 1);
            const schedule = getCreditInstallmentSchedule(
              accountData,
              Number(movimiento.valor),
              installmentCount,
              purchaseDate
            );
            if (!schedule) throw new Error("CREDIT_STATEMENT_UNAVAILABLE");
            const statements = schedule.map((installment) => {
              const cutoffDate = getLocalDateString(installment.cutoffDate);
              const id = `tarjeta-${movimiento.cuentaId}-${cutoffDate}`;
              return {
                id,
                amount: installment.amount,
                ref: doc(db, "obligaciones", id),
              };
            });
            const statementSnapshots = await Promise.all(
              statements.map(({ ref }) => transaction.get(ref))
            );
            const creditChanges = applyCreditPayment(accountData, Number(movimiento.valor));
            availableAfter = creditChanges.saldo;
            debtAfter = creditChanges.deudaActual;

            statements.forEach((statement, index) => {
              const snapshot = statementSnapshots[index];
              if (!snapshot.exists()) return;
              const currentStatement = snapshot.data();
              if (currentStatement.usuarioId !== (movimiento.usuarioId || movimiento.userId) ||
                currentStatement.tarjetaId !== movimiento.cuentaId) {
                throw new Error("CREDIT_STATEMENT_UNAVAILABLE");
              }
              const value = Math.max(0, Number(currentStatement.valor || 0) - statement.amount);
              const remaining = Math.max(
                0,
                Number(currentStatement.montoPendiente ?? currentStatement.valor ?? 0) -
                  statement.amount
              );
              if (value === 0) {
                transaction.delete(statement.ref);
              } else {
                transaction.update(statement.ref, {
                  valor: value,
                  montoPendiente: remaining,
                  activa: remaining > 0,
                  anulada: remaining <= 0,
                  ultimaActualizacion: new Date(),
                });
              }
            });
            transaction.update(accountRef, {
              saldo: availableAfter,
              deudaActual: debtAfter,
              ultimaActualizacion: new Date(),
            });
            transaction.delete(doc(db, "movimientos", movimiento.id));
          });

          setAccounts((previous) => previous.map((account) =>
            account.id === movimiento.cuentaId
              ? { ...account, saldo: availableAfter, deudaActual: debtAfter }
              : account
          ));
          if (movimiento._source === "userId") {
            setMovementsById((previous) => previous.filter((item) => item.id !== movimiento.id));
          } else {
            setMovementsByUsuarioId((previous) => previous.filter((item) => item.id !== movimiento.id));
          }
          showToast("Compra revertida; se eliminaron sus cuotas de los extractos", "success");
          return;
        }

        const obligationRef = (isCreditPurchase || isCreditAdvance) && movimiento.obligacionId
          ? doc(db, "obligaciones", movimiento.obligacionId)
          : null;
        let availableAfter = 0;
        let debtAfter = 0;
        await runTransaction(db, async (transaction) => {
          const accountSnapshot = await transaction.get(accountRef);
          if (!accountSnapshot.exists()) throw new Error("CUENTA_NO_ENCONTRADA");
          const obligationSnapshot = obligationRef
            ? await transaction.get(obligationRef)
            : null;
          const accountData = accountSnapshot.data();
          const value = Number(movimiento.valor);
          const creditChanges = applyCreditPayment(accountData, value);
          availableAfter = creditChanges.saldo;
          debtAfter = creditChanges.deudaActual;
          transaction.update(accountRef, {
            saldo: availableAfter,
            deudaActual: debtAfter,
            ultimaActualizacion: new Date(),
          });
          if (obligationSnapshot?.exists()) {
            const statement = obligationSnapshot.data();
            const statementTotal = Math.max(0, Number(statement.valor || 0) - value);
            const statementRemaining = Math.max(
              0,
              Number(statement.montoPendiente ?? statement.valor ?? 0) - value
            );
            transaction.update(obligationRef, {
              valor: statementTotal,
              montoPendiente: statementRemaining,
              activa: statementRemaining > 0,
              anulada: statementTotal <= 0,
              ultimaActualizacion: new Date(),
            });
          }
          transaction.delete(doc(db, "movimientos", movimiento.id));
        });

        setAccounts((previous) => previous.map((account) => account.id === movimiento.cuentaId
          ? { ...account, saldo: availableAfter, deudaActual: debtAfter }
          : account));
        if (movimiento._source === "userId") {
          setMovementsById((previous) => previous.filter((item) => item.id !== movimiento.id));
        } else {
          setMovementsByUsuarioId((previous) => previous.filter((item) => item.id !== movimiento.id));
        }
        showToast(isCreditAdvance ? "Avance de tarjeta revertido" : "Compra con tarjeta revertida", "success");
        return;
      }

      if (isTransfer) {
        const sourceRef = doc(db, "cuentas", movimiento.cuentaId);
        const destinationRef = movimiento.cuentaDestinoId
          ? doc(db, "cuentas", movimiento.cuentaDestinoId)
          : null;
        let sourceBalanceAfter = 0;
        let destinationBalanceAfter = 0;
        let destinationDebtAfter = null;
        const obligationAbonos = Array.isArray(movimiento.obligacionAbonos)
          ? movimiento.obligacionAbonos.filter((item) =>
            item?.obligacionId && Number(item.valor) > 0
          )
          : [];
        const obligationRefs = obligationAbonos.map((item) => ({
          id: item.obligacionId,
          ref: doc(db, "obligaciones", item.obligacionId),
          amount: Number(item.valor),
        }));

        await runTransaction(db, async (transaction) => {
          const sourceSnapshot = await transaction.get(sourceRef);
          const destinationSnapshot = destinationRef
            ? await transaction.get(destinationRef)
            : null;
          const obligationSnapshots = await Promise.all(
            obligationRefs.map(({ ref }) => transaction.get(ref))
          );
          if (!sourceSnapshot.exists() || (destinationSnapshot && !destinationSnapshot.exists())) {
            throw new Error("CUENTA_NO_ENCONTRADA");
          }

          const sourceBalance = Number(sourceSnapshot.data().saldo || 0);
          const value = Number(movimiento.valor);
          sourceBalanceAfter = sourceBalance + value;
          transaction.update(sourceRef, {
            saldo: sourceBalanceAfter,
            ultimaActualizacion: new Date(),
          });
          if (destinationRef && destinationSnapshot) {
            const destinationData = destinationSnapshot.data();
            const destinationBalance = Number(destinationData.saldo || 0);
            if (destinationData.tipoCuenta === "credito") {
              const creditChanges = applyCreditPurchase(destinationData, value);
              destinationBalanceAfter = creditChanges.saldo;
              destinationDebtAfter = creditChanges.deudaActual;
              transaction.update(destinationRef, {
                saldo: destinationBalanceAfter,
                deudaActual: destinationDebtAfter,
                ultimaActualizacion: new Date(),
              });
            } else {
              const destinationValue = Number(movimiento.valorDestino ?? value);
              if (destinationBalance < destinationValue) throw new Error("SALDO_DESTINO_INSUFICIENTE");
              destinationBalanceAfter = destinationBalance - destinationValue;
              transaction.update(destinationRef, {
                saldo: destinationBalanceAfter,
                ultimaActualizacion: new Date(),
              });
            }
          }
          obligationSnapshots.forEach((snapshot, index) => {
            if (!snapshot.exists()) return;
            const statement = snapshot.data();
            if (statement.usuarioId !== (movimiento.usuarioId || movimiento.userId) ||
              statement.tarjetaId !== movimiento.cuentaDestinoId) return;
            const amount = obligationRefs[index].amount;
            const remaining = Number(statement.montoPendiente ?? statement.valor ?? 0) + amount;
            transaction.update(obligationRefs[index].ref, {
              montoPendiente: remaining,
              activa: remaining > 0,
              anulada: false,
              ultimaActualizacion: new Date(),
            });
          });
          transaction.delete(doc(db, "movimientos", movimiento.id));
        });

        setAccounts((previous) => previous.map((account) => {
          if (account.id === movimiento.cuentaId) return { ...account, saldo: sourceBalanceAfter };
          if (destinationRef && account.id === movimiento.cuentaDestinoId) {
            return { ...account, saldo: destinationBalanceAfter, ...(destinationDebtAfter !== null ? { deudaActual: destinationDebtAfter } : {}) };
          }
          return account;
        }));
        if (movimiento._source === "userId") {
          setMovementsById((previous) => previous.filter((item) => item.id !== movimiento.id));
        } else {
          setMovementsByUsuarioId((previous) => previous.filter((item) => item.id !== movimiento.id));
        }
        showToast(isCardPayment ? "Abono revertido; la deuda de la tarjeta fue restaurada" : "Transferencia revertida correctamente", "success");
        return;
      }

      if (isIncomeMovement) {
        const accountRef = doc(db, "cuentas", movimiento.cuentaId || selectedCuentaId);
        let balanceAfter = 0;
        await runTransaction(db, async (transaction) => {
          const accountSnapshot = await transaction.get(accountRef);
          if (!accountSnapshot.exists()) throw new Error("CUENTA_NO_ENCONTRADA");
          const accountData = accountSnapshot.data();
          const balance = Number(accountData.saldo || 0);
          const value = getMovementAmount(movimiento, selectedCuentaId);
          if (balance < value) throw new Error("SALDO_INGRESO_INSUFICIENTE");
          balanceAfter = balance - value;
          transaction.update(accountRef, {
            saldo: balanceAfter,
            ultimaActualizacion: new Date(),
          });
          transaction.delete(doc(db, "movimientos", movimiento.id));
        });

        setAccounts((previous) => previous.map((account) =>
          account.id === (movimiento.cuentaId || selectedCuentaId)
            ? { ...account, saldo: balanceAfter }
            : account
        ));
        if (movimiento._source === "userId") {
          setMovementsById((previous) => previous.filter((item) => item.id !== movimiento.id));
        } else {
          setMovementsByUsuarioId((previous) => previous.filter((item) => item.id !== movimiento.id));
        }
        showToast("Ingreso eliminado y saldo descontado correctamente", "success");
        return;
      }

      const nuevoSaldo = Number(cuentaActual.saldo || 0) + Number(movimiento.valor || 0);

      // 2. Actualizar el saldo de la cuenta en Firestore
      const cuentaRef = doc(db, "cuentas", movimiento.cuentaId || selectedCuentaId);

      // 2. Actualizar el saldo de la cuenta
      await updateDoc(cuentaRef, {
        saldo: nuevoSaldo,
        ultimaActualizacion: new Date(),
      });

      // 3. Eliminar el movimiento
      await deleteDoc(doc(db, "movimientos", movimiento.id));

      // 4. Actualizar estado local
      setAccounts((prev) =>
        prev.map((c) =>
          c.id === (movimiento.cuentaId || selectedCuentaId) ? { ...c, saldo: nuevoSaldo } : c
        )
      );

      // 5. Actualizar lista de movimientos
      if (movimiento._source === "userId") {
        setMovementsById((prev) => prev.filter((m) => m.id !== movimiento.id));
      } else {
        setMovementsByUsuarioId((prev) => prev.filter((m) => m.id !== movimiento.id));
      }

      showToast("Movimiento eliminado correctamente", "success");
    } catch (error) {
      console.error("Error al eliminar movimiento:", error);
      showToast(
        error.message === "SALDO_DESTINO_INSUFICIENTE"
          ? "No se puede revertir: el destino ya no tiene ese saldo disponible"
          : error.message === "SALDO_INGRESO_INSUFICIENTE"
          ? "No se puede eliminar: la cuenta no tiene saldo suficiente para revertir el ingreso"
          : error.message === "CREDIT_PURCHASE_ALREADY_SETTLED"
          ? "No se puede revertir: parte de la deuda de la tarjeta ya fue pagada por fuera de esta obligación"
          : error.message === "CREDIT_DEBT_UNAVAILABLE" ||
            error.message === "CREDIT_OBLIGATION_UNAVAILABLE" ||
            error.message === "CREDIT_PAYMENT_ACCOUNT_UNAVAILABLE"
          ? "No se pudo encontrar la deuda, su obligación o una cuenta asociada al pago"
          : "No se pudo eliminar el movimiento",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  /* ── Render ── */
  return (
    <div className="ver-page">
      {loading && <Loading message="Cargando movimientos..." />}
      <div className="ver-panel">

        {/* HEADER */}
        <div className="ver-header">
          <div className="ver-header-text">
            <h2>Movimientos de cuenta</h2>
            <p>Selecciona una cuenta para ver su historial de transacciones.</p>
          </div>
          <button className="ver-close" onClick={onClose}>
            Cerrar
          </button>
        </div>

        {/* SELECTOR DE CUENTA */}
        <div className="ver-cuenta-bar">
          <span className="ver-cuenta-label">Cuenta</span>
          <select
            id="cuentaSelect"
            className="ver-select"
            value={selectedCuentaId}
            onChange={(e) => {
              setSelectedCuentaId(e.target.value);
              setSelectedTags([]);
              setSelectedConcepts([]);
            }}
          >
            <option value="">-- Elige una cuenta --</option>
            {accounts.map((cuenta) => (
              <option key={cuenta.id} value={cuenta.id}>
                {cuenta.banco} – {cuenta.nombre} ($
                {formatMoney(cuenta.saldo)})
              </option>
            ))}
          </select>
        </div>

        {/* CONTROLES DE FILTRO */}
        {selectedCuentaId && (
          <div className="ver-filters-bar">
            <div className="ver-filter-group">
              <label>Período</label>
              <select
                className="ver-select"
                value={filterPeriod}
                onChange={(e) => setFilterPeriod(e.target.value)}
              >
                <option value="todos">Todos</option>
                <option value="semanal">Últimos 7 días</option>
                <option value="quincenal">Últimos 15 días</option>
                <option value="mensual">Últimos 30 días</option>
              </select>
            </div>

            <div className="ver-filter-group">
              <label>Tipo</label>
              <select
                className="ver-select"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="todos">Todos</option>
                <option value="ingreso">Ingresos</option>
                <option value="egreso">Egresos</option>
                <option value="deuda">Pagos de deudas</option>
              </select>
            </div>

            <div className="ver-filter-group">
              <label>Tags y conceptos</label>
              <button
                className={`ver-filter-button ${selectedTags.length + selectedConcepts.length > 0 ? "ver-filter-button--active" : ""}`}
                type="button"
                onClick={() => setIsFilterOpen(true)}
              >
                {selectedTags.length + selectedConcepts.length > 0
                  ? `${selectedTags.length + selectedConcepts.length} seleccionados`
                  : "Abrir filtros"}
              </button>
            </div>
          </div>
        )}

        <Filtro
          isOpen={isFilterOpen}
          onClose={() => setIsFilterOpen(false)}
          availableTags={availableTags}
          availableConcepts={availableConcepts}
          selectedTags={selectedTags}
          selectedConcepts={selectedConcepts}
          onApply={(tags, concepts) => {
            setSelectedTags(tags);
            setSelectedConcepts(concepts);
          }}
          onClear={() => {
            setSelectedTags([]);
            setSelectedConcepts([]);
          }}
        />

        {/* TARJETAS RESUMEN */}
        {selectedCuentaId && (
          <div className="ver-summary">
            <div className="ver-summary-card ver-summary-card--accent">
              <span className="ver-summary-card__label">Saldo actual</span>
              <span className="ver-summary-card__value">
                ${formatMoney(cuentaActual?.saldo ?? 0)}
              </span>
            </div>
            <div className="ver-summary-card ver-summary-card--danger">
              <span className="ver-summary-card__label">Total egresado</span>
              <span className="ver-summary-card__value">
                ${formatMoney(totalEgresos)}
              </span>
            </div>
            <div className="ver-summary-card ver-summary-card--success">
              <span className="ver-summary-card__label">Total ingresado</span>
              <span className="ver-summary-card__value">
                ${formatMoney(totalIngresos)}
              </span>
            </div>
            <div className="ver-summary-card">
              <span className="ver-summary-card__label">Deudas pendientes</span>
              <span
                className="ver-summary-card__value"
                style={{ color: debts.length > 0 ? "#ef4444" : "#10b981" }}
              >
                {debts.length > 0
                  ? `${debts.length} deuda${debts.length > 1 ? "s" : ""}`
                  : "Ninguna"}
              </span>
            </div>
            <div className="ver-summary-card">
              <span className="ver-summary-card__label">Total deudas</span>
              <span className="ver-summary-card__value">
                ${formatMoney(totalDeudas)}
              </span>
            </div>
            <div className="ver-summary-card">
              <span className="ver-summary-card__label">Movimientos</span>
              <span className="ver-summary-card__value">{cantMovimientos}</span>
            </div>
            {(selectedTags.length > 0 || selectedConcepts.length > 0) && (
              <>
                <div className="ver-summary-card ver-summary-card--tag">
                  <span className="ver-summary-card__label">
                    Gastado en {[...selectedTags, ...selectedConcepts].join(", ")}
                  </span>
                  <span className="ver-summary-card__value">${formatMoney(totalTagGastado)}</span>
                </div>
                <div className="ver-summary-card ver-summary-card--tag">
                  <span className="ver-summary-card__label">Fechas filtradas</span>
                  <span className="ver-summary-card__value ver-summary-card__value--date">
                    {formatDate(firstMovementDate)} - {formatDate(lastMovementDate)}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* LISTA / TABLA */}
        <div className="ver-list">
          {accounts.length === 0 ? (
            <div className="ver-empty">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="2" y="5" width="20" height="14" rx="3" />
                <path d="M2 10h20" />
              </svg>
              <span>No tienes cuentas registradas.</span>
            </div>
          ) : !selectedCuentaId ? (
            <div className="ver-empty">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <span>Selecciona una cuenta para ver los movimientos.</span>
            </div>
          ) : filteredMovements.length === 0 ? (
            <div className="ver-empty">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="M9 12h6M9 16h4" />
              </svg>
              <span>No hay movimientos que coincidan con los filtros seleccionados.</span>
            </div>
          ) : (
            <>
              <table className="ver-table">
                <thead>
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Valor</th>
                    <th>Concepto</th>
                    <th>Tipo</th>
                    <th>Tags</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMovements.map((m) => (
                    <tr key={`${m._source}-${m.id}`}>
                      <td>{formatDateTime(m.fechaHora)}</td>
                      <td>
                        {isIngreso(m, selectedCuentaId) ? (
                          <span className="ver-valor ver-valor--ingreso">
                            +${formatMoney(getMovementAmount(m, selectedCuentaId))}
                          </span>
                        ) : (
                          <span className="ver-valor ver-valor--egreso">
                            −${formatMoney(getMovementAmount(m, selectedCuentaId))}
                          </span>
                        )}
                      </td>
                      <td>
                        {m.nombreEstablecimiento || m.establecimiento || (m.tipo === "transferencia"
                          ? m.tipoTransferencia === "externa"
                            ? `${m.descripcion || "TRANSFERENCIA"} · Para: ${m.destinatarioNombre}`
                            : `${m.descripcion || "TRANSFERENCIA"} · ${m.cuentaDestinoBanco || ""} ${m.cuentaDestinoNombre || ""}`.trim()
                          : m.descripcion) || "−"}
                      </td>
                      <td>
                        {isPagoDeuda(m) ? (
                          <span className="ver-tag-badge ver-tag-badge--deuda">
                            Pago deuda
                          </span>
                        ) : isIngreso(m, selectedCuentaId) ? (
                          <span className="ver-tag-badge ver-tag-badge--ingreso">
                            Ingreso
                          </span>
                        ) : (
                          <span className="ver-tag-badge ver-tag-badge--egreso">
                            {m.tipo === "transferencia"
                              ? "Transferencia"
                              : m.tipo === "credito_avance"
                              ? `Avance${m.cuotas ? ` · ${m.cuotas} cuotas` : ""}`
                              : m.tipo === "credito_compra"
                              ? `Compra tarjeta${m.cuotas ? ` · ${m.cuotas} ${Number(m.cuotas) === 1 ? "cuota" : "cuotas"}` : ""}`
                              : "Egreso"}
                          </span>
                        )}
                      </td>
                      <td>
                        {(m.tags || []).map((tag, i) => (
                          <span key={i} className="ver-tag-badge">
                            {tag}
                          </span>
                        ))}
                      </td>
                      <td>
                        <button
                          className="ver-delete-btn"
                          type="button"
                          onClick={() => handleDeleteMovimiento(m)}
                          title="Eliminar movimiento"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* PAGINACIÓN */}
              <div className="ver-pagination">
                <button
                  className="ver-pagination-btn"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={validPage === 1}
                >
                  ← Anterior
                </button>

                <div className="ver-pagination-info">
                  Página {validPage} de {totalPages || 1} ({filteredMovements.length} movimientos)
                </div>

                <button
                  className="ver-pagination-btn"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={validPage === totalPages}
                >
                  Siguiente →
                </button>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
};

export default VerMovimientos;