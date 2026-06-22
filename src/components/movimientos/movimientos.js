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
        const defaultAccount = accountDocs.find((c) => c.esDefault);
        if (defaultAccount) {
          setSelectedCuentaId(defaultAccount.id);
        }

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
      setFormValues(initialForm);
      setTags([]);
      setTagInput("");
      setSelectedCuentaId("");
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

  const handleSubmit = async (event) => {
    event.preventDefault();

    const valor = Number(formValues.valor.replace(/\./g, ""));
    const establecimiento = formValues.establecimiento.trim().toUpperCase();
    const fechaHora = new Date();
    const finalTags = tagInput.trim()
      ? [...tags, tagInput.trim()]
      : tags;

    const user = auth.currentUser;
    if (!user) { showToast("Necesitas iniciar sesión", "error"); return; }
    if (!selectedCuentaId) { showToast("Selecciona una cuenta para pagar", "error"); return; }
    if (!valor || !establecimiento) { showToast("Completa todos los campos del movimiento", "error"); return; }

    const cuentaSeleccionada = accounts.find((c) => c.id === selectedCuentaId);
    if (!cuentaSeleccionada) { showToast("Cuenta inválida", "error"); return; }
    if (cuentaSeleccionada.saldo < valor) { showToast("Saldo insuficiente en la cuenta seleccionada", "error"); return; }

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
      setFormValues(initialForm);
      setTags([]);
      setTagInput("");
      setSugerencia(null);
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
            <h2>Registrar pago</h2>
            <p>Llena los datos de la compra y pulsa Pagar.</p>
          </div>
          <button className="mov-close" onClick={onClose}>Cerrar</button>
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
              {accounts.map((cuenta) => (
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
            Pagar
          </button>
        </form>

      </div>
    </div>
  );
};

export default Movimientos;