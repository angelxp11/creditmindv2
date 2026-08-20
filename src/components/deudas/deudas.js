import React, { useEffect, useState } from "react";
import { auth, db } from "../../server/api";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp,
  doc,
} from "firebase/firestore";
import Loading from "../../resources/loading/loading";
import { showToast } from "../../resources/toastcontainer/ToastContainer";
import "./deudas.css";

const initialForm = {
  nombre: "",
  monto: "",
  fechaAdquisicion: "",
  tieneInteres: false,
  proximaFechaPago: "",
};

const Deudas = ({ isOpen, onClose }) => {
  const [deudas, setDeudas] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [formValues, setFormValues] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState("view"); // "create" | "view"
  const [filterMode, setFilterMode] = useState("proximaPago"); // "proximaPago" | "mayorMenor"
  const [paymentModal, setPaymentModal] = useState({
    isOpen: false,
    deudaId: null,
    montoDisponible: 0,
    montoAPagar: "",
    cuentaSeleccionada: "",
    tipoPago: "parcial", // "parcial" | "total"
  });

  useEffect(() => {
    if (!isOpen) {
      setFormValues(initialForm);
      setEditingId(null);
      setViewMode("view");
      return;
    }

    const fetchData = async () => {
      const user = auth.currentUser;
      if (!user) return;
      setLoading(true);
      try {
        const [deudasSnap, cuentasSnap] = await Promise.all([
          getDocs(query(collection(db, "deudas"), where("usuarioId", "==", user.uid))),
          getDocs(query(collection(db, "cuentas"), where("usuarioId", "==", user.uid))),
        ]);

        const deudaDocs = deudasSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) =>
            (b.fechaCreacion?.toMillis?.() ?? 0) - (a.fechaCreacion?.toMillis?.() ?? 0)
          );
        setDeudas(deudaDocs);

        const cuentasDocs = cuentasSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((cuenta) => (cuenta.tipoCuenta || "gastos") === "gastos");
        setCuentas(cuentasDocs);
      } catch (error) {
        console.error("Error cargando datos:", error);
        showToast("No se pudieron cargar las deudas", "error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen]);

  /* ── Helpers ── */
  const formatNumber = (value) => {
    const num = Number(value);
    const abs = String(Math.abs(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return num < 0 ? `-${abs}` : abs;
  };

  const getDateString = (dateField) => {
    if (!dateField) return "";
    try {
      const d = dateField.toDate ? dateField.toDate() : new Date(dateField);
      return d.toISOString().split("T")[0];
    } catch {
      return "";
    }
  };

  const getProgressPercentage = (deuda) => {
    const monto = deuda.monto || 0;
    const restante = deuda.montoRestante ?? monto;
    if (monto === 0) return 100;
    return Math.min(100, Math.round(((monto - restante) / monto) * 100));
  };

  const isPagada = (deuda) => (deuda.montoRestante ?? deuda.monto) <= 0;

  const getFilteredDeudas = () => {
    const pendientes = deudas.filter((d) => !isPagada(d));
    const pagadas = deudas.filter((d) => isPagada(d));

    let deudasOrdenadas = pendientes;
    if (filterMode === "mayorMenor") {
      deudasOrdenadas = pendientes.sort((a, b) => b.monto - a.monto);
    } else if (filterMode === "proximaPago") {
      deudasOrdenadas = pendientes.sort((a, b) => {
        const fechaA = a.proximaFechaPago?.toDate?.() ?? new Date(a.proximaFechaPago);
        const fechaB = b.proximaFechaPago?.toDate?.() ?? new Date(b.proximaFechaPago);
        return fechaA - fechaB;
      });
    }

    return [...deudasOrdenadas, ...pagadas];
  };

  /* ── Form handlers ── */
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === "monto") {
      const cleanValue = value.replace(/\./g, "");
      setFormValues((prev) => ({ ...prev, monto: cleanValue ? formatNumber(cleanValue) : "" }));
      return;
    }
    setFormValues((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleMontoKeyDown = (e) => {
    const allowed = ["Backspace","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Delete","Tab"];
    if (!allowed.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault();
  };

  const handleMontoPaste = (e) => {
    const paste = e.clipboardData.getData("text");
    if (!/^\d+$/.test(paste.replace(/\./g, ""))) e.preventDefault();
  };

  /* ── Submit crear/editar deuda ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    const nombre = formValues.nombre.trim();
    const monto = Number(formValues.monto.replace(/\./g, ""));
    const user = auth.currentUser;

    if (!user) { showToast("No hay usuario autenticado", "error"); return; }
    if (!nombre || !monto || !formValues.fechaAdquisicion || !formValues.proximaFechaPago) {
      showToast("Completa todos los datos correctamente", "error");
      return;
    }

    setLoading(true);
    try {
      const fechaAdquisicion = new Date(formValues.fechaAdquisicion);
      const proximaFechaPago = new Date(formValues.proximaFechaPago);

      if (editingId) {
        await updateDoc(doc(db, "deudas", editingId), {
          nombre, monto, fechaAdquisicion,
          tieneInteres: formValues.tieneInteres,
          proximaFechaPago,
          ultimaActualizacion: serverTimestamp(),
        });
        setDeudas((prev) =>
          prev.map((d) =>
            d.id === editingId
              ? { ...d, nombre, monto, fechaAdquisicion, tieneInteres: formValues.tieneInteres, proximaFechaPago }
              : d
          )
        );
        showToast("Deuda actualizada correctamente", "success");
      } else {
        const docRef = await addDoc(collection(db, "deudas"), {
          nombre, monto, fechaAdquisicion,
          tieneInteres: formValues.tieneInteres,
          proximaFechaPago,
          usuarioId: user.uid,
          montoRestante: monto,
          pagada: false,
          fechaCreacion: serverTimestamp(),
          ultimaActualizacion: serverTimestamp(),
        });
        setDeudas((prev) => [
          { id: docRef.id, nombre, monto, fechaAdquisicion, tieneInteres: formValues.tieneInteres,
            proximaFechaPago, usuarioId: user.uid, montoRestante: monto, pagada: false },
          ...prev,
        ]);
        showToast("Deuda creada correctamente", "success");
      }

      setFormValues(initialForm);
      setEditingId(null);
      setViewMode("view");
    } catch (error) {
      console.error("Error guardando deuda:", error);
      showToast("No se pudo guardar la deuda", "error");
    } finally {
      setLoading(false);
    }
  };

  /* ── Editar ── */
  const handleEdit = (deuda) => {
    setEditingId(deuda.id);
    setFormValues({
      nombre: deuda.nombre,
      monto: formatNumber(deuda.monto.toString()),
      fechaAdquisicion: getDateString(deuda.fechaAdquisicion),
      tieneInteres: deuda.tieneInteres,
      proximaFechaPago: getDateString(deuda.proximaFechaPago),
    });
    setViewMode("create");
  };

  /* ── Modal de pago ── */
  const openPaymentModal = (deuda) => {
    if (isPagada(deuda)) { showToast("Esta deuda ya está pagada", "info"); return; }
    if (cuentas.length === 0) { showToast("No tienes cuentas registradas", "error"); return; }
    setPaymentModal({
      isOpen: true,
      deudaId: deuda.id,
      montoDisponible: deuda.montoRestante ?? deuda.monto,
      montoAPagar: "",
      cuentaSeleccionada: cuentas[0]?.id || "",
      tipoPago: "parcial",
    });
  };

  const closePaymentModal = () =>
    setPaymentModal({ isOpen: false, deudaId: null, montoDisponible: 0, montoAPagar: "", cuentaSeleccionada: "", tipoPago: "parcial" });

  const handlePaymentChange = (e) => {
    const cleanValue = e.target.value.replace(/\./g, "");
    setPaymentModal((prev) => ({ ...prev, montoAPagar: cleanValue ? formatNumber(cleanValue) : "" }));
  };

  /* ── Procesar pago ── */
  const handlePayment = async () => {
    const deudaActual = deudas.find((d) => d.id === paymentModal.deudaId);
    const cuentaActual = cuentas.find((c) => c.id === paymentModal.cuentaSeleccionada);
    const montoRestanteActual = deudaActual.montoRestante ?? deudaActual.monto;

    // Si es pago total, usar el monto restante directamente
    const montoAPagar =
      paymentModal.tipoPago === "total"
        ? montoRestanteActual
        : Number(paymentModal.montoAPagar.replace(/\./g, ""));

    if (Number.isNaN(montoAPagar) || montoAPagar <= 0) {
      showToast("Ingresa un monto válido", "error"); return;
    }
    if (montoAPagar > montoRestanteActual) {
      showToast("El monto no puede ser mayor a la deuda restante", "error"); return;
    }
    if (!paymentModal.cuentaSeleccionada) {
      showToast("Selecciona una cuenta para el pago", "error"); return;
    }

    const saldoCuenta = Number(cuentaActual.saldo) || 0;
    if (montoAPagar > saldoCuenta) {
      showToast("Saldo insuficiente en la cuenta seleccionada", "error"); return;
    }

    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) { showToast("No hay usuario autenticado", "error"); return; }

      const nuevoMontoRestante = montoRestanteActual - montoAPagar;
      const deudaPagada = nuevoMontoRestante <= 0;

      // Avanzar próxima fecha de pago un mes (solo si no queda saldada)
      let proximaFechaPago = null;
      if (!deudaPagada) {
        proximaFechaPago = new Date(deudaActual.proximaFechaPago.toDate?.() ?? deudaActual.proximaFechaPago);
        proximaFechaPago.setMonth(proximaFechaPago.getMonth() + 1);
      }

      const nuevoSaldoCuenta = saldoCuenta - montoAPagar;

      // 1. Actualizar deuda
      await updateDoc(doc(db, "deudas", paymentModal.deudaId), {
        montoRestante: nuevoMontoRestante,
        pagada: deudaPagada,
        ...(proximaFechaPago ? { proximaFechaPago } : {}),
        ultimaActualizacion: serverTimestamp(),
      });

      // 2. Descontar saldo de cuenta
      await updateDoc(doc(db, "cuentas", paymentModal.cuentaSeleccionada), {
        saldo: nuevoSaldoCuenta,
        ultimaActualizacion: serverTimestamp(),
      });

      // 3. Registrar movimiento como egreso (establecimiento = nombre deuda)
      await addDoc(collection(db, "movimientos"), {
        userId: user.uid,
        usuarioId: user.uid,
        cuentaId: paymentModal.cuentaSeleccionada,
        cuentaBanco: cuentaActual.banco,
        cuentaNombre: cuentaActual.nombre,
        valor: montoAPagar,
        establecimiento: `Pago deuda: ${deudaActual.nombre}`,
        tipo: "pago_deuda",
        fechaCreacion: serverTimestamp(),
        fechaHora: new Date(),
      });

      // 4. Actualizar estado local
      setDeudas((prev) =>
        prev.map((d) =>
          d.id === paymentModal.deudaId
            ? { ...d, montoRestante: nuevoMontoRestante, pagada: deudaPagada, ...(proximaFechaPago ? { proximaFechaPago } : {}) }
            : d
        )
      );
      setCuentas((prev) =>
        prev.map((c) =>
          c.id === paymentModal.cuentaSeleccionada ? { ...c, saldo: nuevoSaldoCuenta } : c
        )
      );

      showToast(deudaPagada ? "🎉 ¡Deuda pagada completamente!" : "Pago parcial registrado correctamente", "success");
      closePaymentModal();
    } catch (error) {
      console.error("Error procesando pago:", error);
      showToast("No se pudo procesar el pago", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="deudas-page">
      {loading && <Loading message="Procesando..." />}
      <div className="deudas-panel">

        {/* HEADER */}
        <div className="deudas-header">
          <div>
            <h2>Deudas</h2>
            <p>Gestiona tus deudas, realiza pagos parciales o totales.</p>
          </div>
          <button className="deudas-close" onClick={onClose}>Cerrar</button>
        </div>

        {/* BOTÓN CREAR */}
        {viewMode === "view" && (
          <div className="deudas-form" style={{ gridTemplateColumns: "1fr" }}>
            <button
              type="button"
              className="deudas-submit"
              onClick={() => { setViewMode("create"); setFormValues(initialForm); setEditingId(null); }}
            >
              + Crear nueva deuda
            </button>
          </div>
        )}

        {/* FORMULARIO */}
        {viewMode === "create" && (
          <form className="deudas-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="nombre">Nombre de la deuda</label>
              <input id="nombre" name="nombre" type="text" value={formValues.nombre}
                onChange={handleChange} placeholder="Ej. Préstamo personal" />
            </div>

            <div className="form-group">
              <label htmlFor="monto">Monto total</label>
              <input id="monto" name="monto" type="text" inputMode="numeric"
                value={formValues.monto} onChange={handleChange}
                onKeyDown={handleMontoKeyDown} onPaste={handleMontoPaste} placeholder="0" />
            </div>

            <div className="form-group">
              <label htmlFor="fechaAdquisicion">Fecha de adquisición</label>
              <input id="fechaAdquisicion" name="fechaAdquisicion" type="date"
                value={formValues.fechaAdquisicion} onChange={handleChange} />
            </div>

            <div className="form-group checkbox-group">
              <label htmlFor="tieneInteres">
                <input id="tieneInteres" name="tieneInteres" type="checkbox"
                  checked={formValues.tieneInteres} onChange={handleChange} />
                ¿Tiene interés?
              </label>
            </div>

            <div className="form-group">
              <label htmlFor="proximaFechaPago">Próxima fecha de pago</label>
              <input id="proximaFechaPago" name="proximaFechaPago" type="date"
                value={formValues.proximaFechaPago} onChange={handleChange} />
            </div>

            <button className="deudas-submit" type="submit">
              {editingId ? "Actualizar deuda" : "Crear deuda"}
            </button>

            <button
              type="button"
              className="deudas-submit"
              style={{ background: "var(--bg-hover)", color: "var(--text-primary)", gridColumn: "span 3" }}
              onClick={() => { setViewMode("view"); setEditingId(null); setFormValues(initialForm); }}
            >
              Cancelar
            </button>
          </form>
        )}

        {/* LISTA */}
        {viewMode === "view" && (
          <div className="deudas-list">
            <div className="deudas-filter-buttons">
              <h3>Mis deudas</h3>
              <div className="deudas-filter-buttons-group">
                <button
                  type="button"
                  onClick={() => setFilterMode("proximaPago")}
                  className={`deudas-filter-btn${filterMode === "proximaPago" ? " deudas-filter-btn--active" : ""}`}
                >
                  Próxima a pagar
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("mayorMenor")}
                  className={`deudas-filter-btn${filterMode === "mayorMenor" ? " deudas-filter-btn--active" : ""}`}
                >
                  Mayor a menor
                </button>
              </div>
            </div>
            {deudas.length === 0 ? (
              <p>No hay deudas registradas aún.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Monto total</th>
                    <th>Restante</th>
                    <th>Progreso</th>
                    <th>Próxima fecha</th>
                    <th>Interés</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredDeudas().map((deuda) => {
                    const pct = getProgressPercentage(deuda);
                    const pagada = isPagada(deuda);
                    return (
                      <tr key={deuda.id} className={pagada ? "deuda-row--pagada" : ""}>
                        <td className={pagada ? "deuda-nombre--pagada" : ""}>{deuda.nombre}</td>
                        <td>${formatNumber(deuda.monto.toString())}</td>
                        <td>
                          {pagada ? (
                            <span className="deuda-badge--pagada">Saldada</span>
                          ) : (
                            `$${formatNumber((deuda.montoRestante ?? deuda.monto).toString())}`
                          )}
                        </td>
                        <td style={{ minWidth: 140 }}>
                          <div className={`deudas-progress-bar${pagada ? " deudas-progress-bar--pagada" : ""}`}>
                            <div className="deudas-progress-fill" style={{ width: `${pct}%` }} />
                            <span className="deudas-progress-text">{pct}%</span>
                          </div>
                        </td>
                        <td>
                          {pagada ? "—" : new Date(
                            deuda.proximaFechaPago.toDate?.() ?? deuda.proximaFechaPago
                          ).toLocaleDateString("es-CO")}
                        </td>
                        <td>{deuda.tieneInteres ? "Sí" : "No"}</td>
                        <td>
                          <div className="deudas-actions">
                            {!pagada && (
                              <button className="deudas-pay" type="button" onClick={() => openPaymentModal(deuda)}>
                                Pagar
                              </button>
                            )}
                            <button className="deudas-edit" type="button" onClick={() => handleEdit(deuda)}>
                              Editar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* MODAL DE PAGO */}
      {paymentModal.isOpen && (() => {
        const deudaActual = deudas.find((d) => d.id === paymentModal.deudaId);
        const montoRestante = deudaActual?.montoRestante ?? deudaActual?.monto ?? 0;
        return (
          <div className="deudas-modal-overlay" onClick={closePaymentModal}>
            <div className="deudas-modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Realizar pago</h3>
              <p>
                Deuda: <strong>{deudaActual?.nombre}</strong><br />
                Restante: <strong>${formatNumber(montoRestante.toString())}</strong>
              </p>

              {/* Tipo de pago */}
              <div className="deudas-tipo-pago">
                <button
                  type="button"
                  className={`deudas-tipo-btn${paymentModal.tipoPago === "parcial" ? " deudas-tipo-btn--active" : ""}`}
                  onClick={() => setPaymentModal((prev) => ({ ...prev, tipoPago: "parcial", montoAPagar: "" }))}
                >
                  Pago parcial
                </button>
                <button
                  type="button"
                  className={`deudas-tipo-btn${paymentModal.tipoPago === "total" ? " deudas-tipo-btn--active" : ""}`}
                  onClick={() => setPaymentModal((prev) => ({ ...prev, tipoPago: "total", montoAPagar: formatNumber(montoRestante.toString()) }))}
                >
                  Pago total
                </button>
              </div>

              {/* Selector de cuenta */}
              <select
                value={paymentModal.cuentaSeleccionada}
                onChange={(e) => setPaymentModal((prev) => ({ ...prev, cuentaSeleccionada: e.target.value }))}
                className="deudas-modal-select"
              >
                <option value="">Selecciona una cuenta</option>
                {cuentas.map((cuenta) => (
                  <option key={cuenta.id} value={cuenta.id}>
                    {cuenta.nombre} – {cuenta.banco} (${formatNumber(String(cuenta.saldo))})
                  </option>
                ))}
              </select>

              {/* Input monto (solo parcial) */}
              {paymentModal.tipoPago === "parcial" && (
                <input
                  type="text"
                  inputMode="numeric"
                  value={paymentModal.montoAPagar}
                  onChange={handlePaymentChange}
                  onKeyDown={handleMontoKeyDown}
                  onPaste={handleMontoPaste}
                  placeholder={`Máximo $${formatNumber(montoRestante.toString())}`}
                  className="deudas-modal-input"
                />
              )}

              {paymentModal.tipoPago === "total" && (
                <div className="deudas-total-preview">
                  Se pagará: <strong>${formatNumber(montoRestante.toString())}</strong>
                </div>
              )}

              <div className="deudas-modal-buttons">
                <button className="deudas-modal-btn deudas-modal-btn--primary" onClick={handlePayment}>
                  Confirmar pago
                </button>
                <button className="deudas-modal-btn deudas-modal-btn--secondary" onClick={closePaymentModal}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Deudas;