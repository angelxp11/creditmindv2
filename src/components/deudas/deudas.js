import React, { useEffect, useState } from "react";
import { auth, db } from "../../server/api";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
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
  const [selectedDeudaIds, setSelectedDeudaIds] = useState([]);
  const [bulkPaymentModal, setBulkPaymentModal] = useState({
    isOpen: false,
    cuentaSeleccionada: "",
  });
  const [paymentModal, setPaymentModal] = useState({
    isOpen: false,
    deudaId: null,
    montoDisponible: 0,
    montoAPagar: "",
    cuentaSeleccionada: "",
    tipoPago: "parcial", // "parcial" | "total"
  });
  const [remainingModal, setRemainingModal] = useState({
    isOpen: false,
    deudaId: null,
    montoRestante: "",
  });
  const [editMenuOpenId, setEditMenuOpenId] = useState(null);

  useEffect(() => {
    if (!isOpen) {
      setFormValues(initialForm);
      setEditingId(null);
      setViewMode("view");
      setSelectedDeudaIds([]);
      setBulkPaymentModal({ isOpen: false, cuentaSeleccionada: "" });
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

  const pendientes = deudas.filter((deuda) => !isPagada(deuda));
  const selectedDeudas = deudas.filter((deuda) => selectedDeudaIds.includes(deuda.id) && !isPagada(deuda));
  const totalSeleccionado = selectedDeudas.reduce(
    (total, deuda) => total + Number(deuda.montoRestante ?? deuda.monto ?? 0),
    0
  );

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
  const toggleEditMenu = (deudaId) => {
    setEditMenuOpenId((prev) => (prev === deudaId ? null : deudaId));
  };

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
    setEditMenuOpenId(null);
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

  const toggleDeudaSelection = (deudaId) => {
    setSelectedDeudaIds((prev) =>
      prev.includes(deudaId) ? prev.filter((id) => id !== deudaId) : [...prev, deudaId]
    );
  };

  const toggleSelectAll = () => {
    setSelectedDeudaIds((prev) =>
      prev.length === pendientes.length ? [] : pendientes.map((deuda) => deuda.id)
    );
  };

  const closeBulkPaymentModal = () =>
    setBulkPaymentModal({ isOpen: false, cuentaSeleccionada: "" });

  const openBulkPaymentModal = () => {
    if (selectedDeudas.length === 0) {
      showToast("Selecciona al menos una deuda pendiente", "info");
      return;
    }
    setBulkPaymentModal({
      isOpen: true,
      cuentaSeleccionada: cuentas[0]?.id || "",
    });
  };

  const handlePaymentChange = (e) => {
    const cleanValue = e.target.value.replace(/\./g, "");
    setPaymentModal((prev) => ({ ...prev, montoAPagar: cleanValue ? formatNumber(cleanValue) : "" }));
  };

  const openRemainingModal = (deuda) => {
    setRemainingModal({
      isOpen: true,
      deudaId: deuda.id,
      montoRestante: String(deuda.montoRestante ?? deuda.monto ?? 0),
    });
  };

  const closeRemainingModal = () => setRemainingModal({ isOpen: false, deudaId: null, montoRestante: "" });

  const handleRemainingChange = (e) => {
    const cleanValue = e.target.value.replace(/\./g, "");
    setRemainingModal((prev) => ({
      ...prev,
      montoRestante: cleanValue ? formatNumber(cleanValue) : "",
    }));
  };

  const handleDeleteDeuda = async (deudaId) => {
    const deudaActual = deudas.find((deuda) => deuda.id === deudaId);
    if (!deudaActual) return;

    const confirmar = window.confirm(`¿Seguro que deseas eliminar la deuda "${deudaActual.nombre}"?`);
    if (!confirmar) return;

    setLoading(true);
    try {
      await deleteDoc(doc(db, "deudas", deudaId));
      setDeudas((prev) => prev.filter((deuda) => deuda.id !== deudaId));
      setSelectedDeudaIds((prev) => prev.filter((id) => id !== deudaId));
      showToast("Deuda eliminada correctamente", "success");
    } catch (error) {
      console.error("Error eliminando deuda:", error);
      showToast("No se pudo eliminar la deuda", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRemaining = async () => {
    const deudaActual = deudas.find((deuda) => deuda.id === remainingModal.deudaId);
    if (!deudaActual) return;

    const nuevoRestante = Number(remainingModal.montoRestante.replace(/\./g, ""));

    if (Number.isNaN(nuevoRestante) || nuevoRestante < 0) {
      showToast("Ingresa un valor válido para el restante", "error");
      return;
    }

    if (nuevoRestante > deudaActual.monto) {
      showToast("El restante no puede ser mayor que el monto total", "error");
      return;
    }

    setLoading(true);
    try {
      const deudaPagada = nuevoRestante <= 0;
      await updateDoc(doc(db, "deudas", deudaActual.id), {
        montoRestante: nuevoRestante,
        pagada: deudaPagada,
        ultimaActualizacion: serverTimestamp(),
      });

      setDeudas((prev) =>
        prev.map((deuda) =>
          deuda.id === deudaActual.id
            ? { ...deuda, montoRestante: nuevoRestante, pagada: deudaPagada }
            : deuda
        )
      );

      showToast("Monto restante actualizado correctamente", "success");
      closeRemainingModal();
    } catch (error) {
      console.error("Error actualizando restante:", error);
      showToast("No se pudo actualizar el monto restante", "error");
    } finally {
      setLoading(false);
    }
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

  const handleBulkPayment = async () => {
    const user = auth.currentUser;
    const cuentaActual = cuentas.find((cuenta) => cuenta.id === bulkPaymentModal.cuentaSeleccionada);

    if (!user) { showToast("No hay usuario autenticado", "error"); return; }
    if (selectedDeudas.length === 0) { showToast("Selecciona al menos una deuda pendiente", "error"); return; }
    if (!cuentaActual) { showToast("Selecciona una cuenta para el pago", "error"); return; }

    const saldoCuenta = Number(cuentaActual.saldo) || 0;
    if (totalSeleccionado > saldoCuenta) {
      showToast("Saldo insuficiente en la cuenta seleccionada", "error"); return;
    }

    setLoading(true);
    try {
      const batch = writeBatch(db);
      const cuentaRef = doc(db, "cuentas", cuentaActual.id);
      const movimientoRefs = [];

      selectedDeudas.forEach((deuda) => {
        batch.update(doc(db, "deudas", deuda.id), {
          montoRestante: 0,
          pagada: true,
          ultimaActualizacion: serverTimestamp(),
        });

        const movimientoRef = doc(collection(db, "movimientos"));
        movimientoRefs.push({ ref: movimientoRef, deuda });
      });

      batch.update(cuentaRef, {
        saldo: saldoCuenta - totalSeleccionado,
        ultimaActualizacion: serverTimestamp(),
      });

      movimientoRefs.forEach(({ ref, deuda }) => {
        batch.set(ref, {
          userId: user.uid,
          usuarioId: user.uid,
          cuentaId: cuentaActual.id,
          cuentaBanco: cuentaActual.banco,
          cuentaNombre: cuentaActual.nombre,
          valor: Number(deuda.montoRestante ?? deuda.monto ?? 0),
          establecimiento: `Pago deuda: ${deuda.nombre}`,
          tipo: "pago_deuda",
          fechaCreacion: serverTimestamp(),
          fechaHora: new Date(),
        });
      });

      await batch.commit();

      setDeudas((prev) => prev.map((deuda) =>
        selectedDeudaIds.includes(deuda.id)
          ? { ...deuda, montoRestante: 0, pagada: true }
          : deuda
      ));
      setCuentas((prev) => prev.map((cuenta) =>
        cuenta.id === cuentaActual.id ? { ...cuenta, saldo: saldoCuenta - totalSeleccionado } : cuenta
      ));
      setSelectedDeudaIds([]);
      closeBulkPaymentModal();
      showToast("Deudas pagadas correctamente", "success");
    } catch (error) {
      console.error("Error procesando pago masivo:", error);
      showToast("No se pudieron procesar las deudas seleccionadas", "error");
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
              <div className="checkbox-wrapper-42">
                <input id="tieneInteres" name="tieneInteres" type="checkbox"
                  checked={formValues.tieneInteres} onChange={handleChange} />
                <label className="cbx" htmlFor="tieneInteres" />
                <label className="lbl" htmlFor="tieneInteres">¿Tiene interés?</label>
              </div>
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
                <button
                  type="button"
                  onClick={openBulkPaymentModal}
                  className="deudas-filter-btn deudas-filter-btn--bulk"
                  disabled={selectedDeudas.length === 0}
                >
                  Pagar seleccionadas ({selectedDeudas.length})
                </button>
              </div>
            </div>
            {deudas.length === 0 ? (
              <p>No hay deudas registradas aún.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th className="deudas-select-column">
                      <div className="checkbox-wrapper-42">
                        <input
                          id="seleccionar-todas-deudas"
                          type="checkbox"
                          checked={pendientes.length > 0 && selectedDeudaIds.length === pendientes.length}
                          onChange={toggleSelectAll}
                          aria-label="Seleccionar todas las deudas pendientes"
                        />
                        <label className="cbx" htmlFor="seleccionar-todas-deudas" />
                      </div>
                    </th>
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
                        <td className="deudas-select-column">
                          <div className="checkbox-wrapper-42">
                            <input
                              id={`seleccionar-deuda-${deuda.id}`}
                              type="checkbox"
                              checked={selectedDeudaIds.includes(deuda.id)}
                              onChange={() => toggleDeudaSelection(deuda.id)}
                              disabled={pagada}
                              aria-label={`Seleccionar deuda ${deuda.nombre}`}
                            />
                            <label className="cbx" htmlFor={`seleccionar-deuda-${deuda.id}`} />
                          </div>
                        </td>
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
                            <div className="deudas-edit-menu">
                              <button className="deudas-edit" type="button" onClick={() => toggleEditMenu(deuda.id)}>
                                Editar
                              </button>
                              {editMenuOpenId === deuda.id && (
                                <div className="deudas-edit-menu__body">
                                  <button className="deudas-edit-subaction" type="button" onClick={() => handleEdit(deuda)}>
                                    Editar datos
                                  </button>
                                  <button className="deudas-remaining" type="button" onClick={() => { setEditMenuOpenId(null); openRemainingModal(deuda); }}>
                                    Restante
                                  </button>
                                  <button className="deudas-delete" type="button" onClick={() => { setEditMenuOpenId(null); handleDeleteDeuda(deuda.id); }}>
                                    Eliminar
                                  </button>
                                </div>
                              )}
                            </div>
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

      {bulkPaymentModal.isOpen && (
        <div className="deudas-modal-overlay" onClick={closeBulkPaymentModal}>
          <div className="deudas-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Pagar deudas seleccionadas</h3>
            <p>
              Se pagarán <strong>{selectedDeudas.length} deudas</strong> por un total de
              <strong>${formatNumber(String(totalSeleccionado))}</strong>.
            </p>
            <select
              value={bulkPaymentModal.cuentaSeleccionada}
              onChange={(e) => setBulkPaymentModal((prev) => ({ ...prev, cuentaSeleccionada: e.target.value }))}
              className="deudas-modal-select"
            >
              <option value="">Selecciona una cuenta</option>
              {cuentas.map((cuenta) => (
                <option key={cuenta.id} value={cuenta.id}>
                  {cuenta.nombre} - {cuenta.banco} (${formatNumber(String(cuenta.saldo))})
                </option>
              ))}
            </select>
            <div className="deudas-modal-buttons">
              <button className="deudas-modal-btn deudas-modal-btn--primary" onClick={handleBulkPayment}>
                Confirmar pagos
              </button>
              <button className="deudas-modal-btn deudas-modal-btn--secondary" onClick={closeBulkPaymentModal}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {remainingModal.isOpen && (() => {
        const deudaActual = deudas.find((deuda) => deuda.id === remainingModal.deudaId);
        const montoTotal = deudaActual?.monto ?? 0;
        const montoRestanteActual = deudaActual?.montoRestante ?? montoTotal;

        return (
          <div className="deudas-modal-overlay" onClick={closeRemainingModal}>
            <div className="deudas-modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Editar monto restante</h3>
              <p>
                Deuda: <strong>{deudaActual?.nombre}</strong><br />
                Total: <strong>${formatNumber(String(montoTotal))}</strong>
              </p>

              <input
                type="text"
                inputMode="numeric"
                value={remainingModal.montoRestante}
                onChange={handleRemainingChange}
                onKeyDown={handleMontoKeyDown}
                onPaste={handleMontoPaste}
                placeholder={`Máximo $${formatNumber(String(montoTotal))}`}
                className="deudas-modal-input"
              />

              <div className="deudas-total-preview">
                Restante actual: <strong>${formatNumber(String(montoRestanteActual))}</strong>
              </div>

              <div className="deudas-modal-buttons">
                <button className="deudas-modal-btn deudas-modal-btn--primary" onClick={handleSaveRemaining}>
                  Guardar cambio
                </button>
                <button className="deudas-modal-btn deudas-modal-btn--secondary" onClick={closeRemainingModal}>
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