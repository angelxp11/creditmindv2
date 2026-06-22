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
} from "firebase/firestore";
import Loading from "../../../resources/loading/loading";
import { showToast } from "../../../resources/toastcontainer/ToastContainer";
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
const isIngreso = (m) =>
  m.descripcion && !m.establecimiento && m.tipo !== "pago_deuda";

const isPagoDeuda = (m) => m.tipo === "pago_deuda";

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
        setSelectedCuentaId(docs[0]?.id || "");
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
            where("userId", "==", user.uid),
            where("cuentaId", "==", selectedCuentaId)
          )
        );
        const docsById = snapById.docs
          .map((d) => ({ id: d.id, ...d.data(), _source: "userId" }))
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
            where("usuarioId", "==", user.uid),
            where("cuentaId", "==", selectedCuentaId)
          )
        );
        const docsByUsuarioId = snapByUsuarioId.docs
          .map((d) => ({ id: d.id, ...d.data(), _source: "usuarioId" }))
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

  /* ── Filtrar por tipo ── */
  const matchesTypeFilter = (movimiento) => {
    if (filterType === "todos") return true;
    if (filterType === "ingreso") return isIngreso(movimiento);
    if (filterType === "egreso") return !isIngreso(movimiento) && !isPagoDeuda(movimiento);
    if (filterType === "deuda") return isPagoDeuda(movimiento);
    return true;
  };

  /* ── Movimientos filtrados y paginados ── */
  const filteredMovements = React.useMemo(() => {
    return allMovements.filter(
      (m) => isWithinPeriod(m, filterPeriod) && matchesTypeFilter(m)
    );
  }, [allMovements, filterPeriod, filterType]);

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
  }, [filterPeriod, filterType, selectedCuentaId]);

  /* ── Cálculos resumen ── */
  const cuentaActual = accounts.find((c) => c.id === selectedCuentaId);

  const totalEgresos = filteredMovements.reduce(
    (acc, m) => acc + (!isIngreso(m) ? getNumber(m.valor) : 0),
    0
  );
  const totalIngresos = filteredMovements.reduce(
    (acc, m) => acc + (isIngreso(m) ? getNumber(m.valor) : 0),
    0
  );
  const cantMovimientos = filteredMovements.length;
  const totalDeudas = debts.reduce(
    (acc, d) => acc + getNumber(d.montoRestante ?? d.monto),
    0
  );

  /* ── Eliminar movimiento ── */
  const handleDeleteMovimiento = async (movimiento) => {
    const confirmDelete = window.confirm(
      `¿Estás seguro de que deseas eliminar este movimiento? Se devolverán $${formatMoney(movimiento.valor)} a la cuenta.`
    );
    if (!confirmDelete) return;

    setLoading(true);
    try {
      // 1. Obtener la cuenta actual del estado local
      const cuentaActual = accounts.find((c) => c.id === selectedCuentaId);
      if (!cuentaActual) {
        showToast("No se encontró la cuenta", "error");
        return;
      }

      const nuevoSaldo = cuentaActual.saldo + movimiento.valor;

      // 2. Actualizar el saldo de la cuenta en Firestore
      const cuentaRef = doc(db, "cuentas", selectedCuentaId);

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
          c.id === selectedCuentaId ? { ...c, saldo: nuevoSaldo } : c
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
      showToast("No se pudo eliminar el movimiento", "error");
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
            onChange={(e) => setSelectedCuentaId(e.target.value)}
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
          </div>
        )}

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
                        {isIngreso(m) ? (
                          <span className="ver-valor ver-valor--ingreso">
                            +${formatMoney(m.valor)}
                          </span>
                        ) : (
                          <span className="ver-valor ver-valor--egreso">
                            −${formatMoney(m.valor)}
                          </span>
                        )}
                      </td>
                      <td>{m.establecimiento || m.descripcion || "−"}</td>
                      <td>
                        {isPagoDeuda(m) ? (
                          <span className="ver-tag-badge ver-tag-badge--deuda">
                            Pago deuda
                          </span>
                        ) : isIngreso(m) ? (
                          <span className="ver-tag-badge ver-tag-badge--ingreso">
                            Ingreso
                          </span>
                        ) : (
                          <span className="ver-tag-badge ver-tag-badge--egreso">
                            Egreso
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