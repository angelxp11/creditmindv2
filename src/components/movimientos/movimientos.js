import React, { useState } from "react";
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
} from "firebase/firestore";
import Loading from "../../resources/loading/loading";
import { showToast } from "../../resources/toastcontainer/ToastContainer";
import "./movimientos.css";

const initialForm = {
  valor: "",
  establecimiento: "",
  fechaHora: "",
};

const initialBudget = {
  fechaProgramada: "",
};

const getCurrentDateTimeValue = () => {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 16);
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
      const newTag = tagInput.trim().replace(/,$/, "");
      if (newTag && !tags.includes(newTag)) {
        setTags((prev) => [...prev, newTag]);
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

  const resetForm = () => {
    setFormValues({ ...initialForm, fechaHora: getCurrentDateTimeValue() });
    setTags([]);
    setTagInput("");
    setSugerencia(null);
    setUsePreviousDate(false);
    setBudgetForm(initialBudget);
  };

  const handleCreateBudget = async () => {
    const valor = Number(formValues.valor.replace(/\./g, ""));
    const establecimiento = formValues.establecimiento.trim().toUpperCase();
    const user = auth.currentUser;

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
        tags: tagInput.trim() ? [...tags, tagInput.trim()] : tags,
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
    const finalTags = tagInput.trim()
      ? [...tags, tagInput.trim()]
      : tags;

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
    if ((cuentaSeleccionada.tipoCuenta || "gastos") !== "gastos") {
      showToast("Las cuentas de ahorros no se pueden usar para pagos", "error"); return;
    }
    if (valor > getAvailableBalance(selectedCuentaId)) {
      showToast("Saldo disponible insuficiente: hay dinero reservado en presupuestos", "error"); return;
    }

    setLoading(true);
    try {
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
      showToast("No se pudo crear el movimiento", "error");
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
            <h2>{mode === "pago" ? "Registrar pago" : "Crear presupuesto"}</h2>
            <p>
              {mode === "pago"
                ? "Llena los datos de la compra y pulsa Pagar."
                : "Reserva una parte de tu saldo y decide después cuándo aceptarla."}
            </p>
          </div>
          <button className="mov-close" onClick={onClose}>Cerrar</button>
        </div>

        <div className="mov-mode-switch" role="tablist" aria-label="Modo de pago">
          <button
            type="button"
            className={mode === "pago" ? "mov-mode-btn mov-mode-btn--active" : "mov-mode-btn"}
            onClick={() => setMode("pago")}
          >
            Pagar ahora
          </button>
          <button
            type="button"
            className={mode === "presupuesto" ? "mov-mode-btn mov-mode-btn--active" : "mov-mode-btn"}
            onClick={() => setMode("presupuesto")}
          >
            Crear presupuesto
          </button>
        </div>

        {/* FORM */}
        <form className="mov-form" onSubmit={handleSubmit}>

          {/* Cuenta */}
          <div className="mov-field">
            <span className="mov-label">Cuenta</span>
            <select
              className="mov-select"
              name="cuentaId"
              value={selectedCuentaId}
              onChange={(e) => setSelectedCuentaId(e.target.value)}
            >
              <option value="">Selecciona una cuenta</option>
              {accounts.filter((cuenta) => (cuenta.tipoCuenta || "gastos") === "gastos").map((cuenta) => (
                <option key={cuenta.id} value={cuenta.id}>
                  {cuenta.banco} – {cuenta.nombre} (${formatMoney(cuenta.saldo)})
                </option>
              ))}
            </select>
          </div>

          {/* Valor */}
          <div className="mov-field">
            <span className="mov-label">Valor</span>
            <input
              className="mov-input"
              name="valor"
              type="text"
              inputMode="numeric"
              value={formValues.valor}
              onChange={handleChange}
              placeholder="0"
            />
          </div>

          {mode === "pago" && (
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
                <span>Registrar como pago anterior</span>
              </label>

              {usePreviousDate && (
                <>
                  <label className="mov-label" htmlFor="fechaHora">
                    Fecha y hora del pago
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
              placeholder="Nombre del comercio"
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
                    setTags(sugerencia.tags);
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
            {mode === "pago" ? "Pagar" : "Guardar presupuesto"}
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

      </div>
    </div>
  );
};

export default Movimientos;