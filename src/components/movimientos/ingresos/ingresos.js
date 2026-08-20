import React, { useState } from "react";
import { auth, db } from "../../../server/api";
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
import Loading from "../../../resources/loading/loading";
import { showToast } from "../../../resources/toastcontainer/ToastContainer";
import "./ingresos.css";

const initialForm = {
  valor: "",
  descripcion: "",
};

const Ingresos = ({ isOpen, onClose }) => {
  const [formValues, setFormValues] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selectedCuentaId, setSelectedCuentaId] = useState("");

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
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.fechaCreacion?.toMillis?.() ?? 0) - (a.fechaCreacion?.toMillis?.() ?? 0));
        setAccounts(accountDocs);
      } catch (error) {
        console.error("Error cargando cuentas:", error);
        showToast("No se pudieron cargar las cuentas", "error");
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      setFormValues(initialForm);
      setSelectedCuentaId("");
      fetchAccounts();
    }
  }, [isOpen]);

  

  const handleChange = (e) => {
  const { name, value } = e.target;

  if (name === "valor") {
    const soloNumeros = value.replace(/\D/g, "");

    const formateado = soloNumeros.replace(
      /\B(?=(\d{3})+(?!\d))/g,
      "."
    );

    setFormValues((prev) => ({
      ...prev,
      valor: formateado,
    }));

    return;
  }

  setFormValues((prev) => ({
    ...prev,
    [name]: value,
  }));
};

  const handleSubmit = async (event) => {
    event.preventDefault();
    const valor = Number(formValues.valor.replace(/\./g, ""));
    const descripcion = formValues.descripcion.trim();
    const fechaHora = new Date();

    const user = auth.currentUser;
    if (!user) { showToast("Necesitas iniciar sesión", "error"); return; }
    if (!selectedCuentaId) { showToast("Selecciona una cuenta", "error"); return; }
    if (!valor || !descripcion) { showToast("Completa todos los campos", "error"); return; }

    const cuentaSeleccionada = accounts.find((c) => c.id === selectedCuentaId);
    if (!cuentaSeleccionada) { showToast("Cuenta inválida", "error"); return; }

    setLoading(true);
    try {
      const cuentaRef = doc(db, "cuentas", selectedCuentaId);
      await updateDoc(cuentaRef, {
        saldo: (cuentaSeleccionada.saldo || 0) + valor,
        ultimaActualizacion: serverTimestamp(),
      });

      await addDoc(collection(db, "movimientos"), {
        userId: user.uid,
        cuentaId: selectedCuentaId,
        cuentaBanco: cuentaSeleccionada.banco,
        cuentaNombre: cuentaSeleccionada.nombre,
        valor,
        descripcion,
        fechaHora,
        fechaCreacion: serverTimestamp(),
      });

      showToast("Ingreso registrado correctamente", "success");
      setFormValues(initialForm);
      setSelectedCuentaId("");
      // Mantener modal abierto: no llamar a onClose()
    } catch (error) {
      console.error("Error guardando ingreso:", error);
      showToast("No se pudo registrar el ingreso", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="ing-page">
      {loading && <Loading message="Registrando ingreso..." />}
      <div className="ing-panel">
        <div className="ing-header">
          <div className="ing-header-text">
            <h2>Registrar ingreso</h2>
            <p>Selecciona la cuenta, ingresa el valor y describe el origen.</p>
          </div>
          <button className="ing-close" onClick={onClose}>Cerrar</button>
        </div>

        <form className="ing-form" onSubmit={handleSubmit}>
          <div className="ing-field">
            <label className="ing-label">Cuenta</label>
            <select
              className="ing-select"
              value={selectedCuentaId}
              onChange={(e) => setSelectedCuentaId(e.target.value)}
            >
              <option value="">Selecciona una cuenta</option>
              {accounts.map((c) => (
                <option key={c.id} value={c.id}>
  {c.banco} – {c.nombre} (${Number(c.saldo || 0).toLocaleString("es-CO")})
</option>
              ))}
            </select>
          </div>

          <div className="ing-field">
            <label className="ing-label">Valor</label>
            <input
              className="ing-input"
              name="valor"
              type="text"
              inputMode="numeric"
              value={formValues.valor}
              onChange={handleChange}
              placeholder="0"
            />
          </div>

          <div className="ing-field ing-field--full">
  <label className="ing-label">Descripción</label>
  <input
    className="ing-input"
    name="descripcion"
    type="text"
    value={formValues.descripcion}
    onChange={handleChange}
    placeholder="Ej. Pago nómina, venta, devolución..."
    style={{ textTransform: "uppercase" }}
  />
</div>

          <button className="ing-submit" type="submit">Registrar ingreso</button>
        </form>
      </div>
    </div>
  );
};

export default Ingresos;
