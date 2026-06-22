import React, { useEffect, useState } from "react";
import { auth, db } from "../../server/api";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp,
  doc,
} from "firebase/firestore";
import Loading from "../../resources/loading/loading";
import { showToast } from "../../resources/toastcontainer/ToastContainer";
import "./cuentas.css";

const initialForm = {
  banco: "",
  nombre: "",
  saldo: "",
};

const Cuentas = ({ isOpen, onClose }) => {
  const [accounts, setAccounts] = useState([]);
  const [formValues, setFormValues] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setFormValues(initialForm);
      setEditingId(null);
      return;
    }

    const fetchAccounts = async () => {
      const user = auth.currentUser;
      if (!user) {
        return;
      }

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
      } catch (error) {
        console.error("Error cargando cuentas:", error);
        showToast("No se pudieron cargar las cuentas", "error");
      } finally {
        setLoading(false);
      }
    };

    fetchAccounts();
  }, [isOpen]);

  

  const handleChange = (event) => {
  const { name, value } = event.target;

  if (name === "saldo") {
    const soloNumeros = value.replace(/\D/g, "");

    const formateado = soloNumeros.replace(
      /\B(?=(\d{3})+(?!\d))/g,
      "."
    );

    setFormValues((prev) => ({
      ...prev,
      saldo: formateado,
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
    const banco = formValues.banco.trim();
    const nombre = formValues.nombre.trim();
    const saldo = Number(
  (formValues.saldo || "").replace(/\./g, "")
);
    const user = auth.currentUser;

    if (!user) {
      showToast("No hay un usuario autenticado", "error");
      return;
    }

    if (!banco || !nombre || Number.isNaN(saldo)) {
      showToast("Completa todos los datos correctamente", "error");
      return;
    }

    setLoading(true);

    try {
      if (editingId) {
        const accountRef = doc(db, "cuentas", editingId);
        await updateDoc(accountRef, {
          banco,
          nombre,
          saldo,
          ultimaActualizacion: serverTimestamp(),
        });

        setAccounts((prev) =>
          prev.map((account) =>
            account.id === editingId
              ? { ...account, banco, nombre, saldo }
              : account
          )
        );
        showToast("Cuenta actualizada correctamente", "success");
      } else {
        const docRef = await addDoc(collection(db, "cuentas"), {
          banco,
          nombre,
          saldo,
          usuarioId: user.uid,
          fechaCreacion: serverTimestamp(),
          ultimaActualizacion: serverTimestamp(),
        });

        setAccounts((prev) => [
          {
            id: docRef.id,
            banco,
            nombre,
            saldo,
            usuarioId: user.uid,
          },
          ...prev,
        ]);
        showToast("Cuenta creada correctamente", "success");
      }

      setFormValues(initialForm);
      setEditingId(null);
    } catch (error) {
      console.error("Error guardando cuenta:", error);
      showToast("No se pudo guardar la cuenta", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (account) => {
    setEditingId(account.id);
    setFormValues({
  banco: account.banco,
  nombre: account.nombre,
  saldo: Number(account.saldo || 0).toLocaleString("es-CO"),
});
  };

  const handleSetDefault = async (account) => {
    const user = auth.currentUser;
    if (!user) {
      showToast("No hay un usuario autenticado", "error");
      return;
    }

    setLoading(true);
    try {
      // Quitarle esDefault a todas las cuentas del usuario
      const allAccountsQuery = query(
        collection(db, "cuentas"),
        where("usuarioId", "==", user.uid)
      );
      const allAccountsSnap = await getDocs(allAccountsQuery);
      for (const doc of allAccountsSnap.docs) {
        if (doc.id !== account.id) {
          await updateDoc(doc.ref, { esDefault: false });
        }
      }

      // Establecer como default
      const accountRef = doc(db, "cuentas", account.id);
      await updateDoc(accountRef, { esDefault: true });

      // Actualizar estado local
      setAccounts((prev) =>
        prev.map((acc) => ({
          ...acc,
          esDefault: acc.id === account.id,
        }))
      );

      showToast("Cuenta predeterminada actualizada", "success");
    } catch (error) {
      console.error("Error al establecer cuenta predeterminada:", error);
      showToast("No se pudo establecer la cuenta predeterminada", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="cuentas-page">
      {loading && <Loading message="Guardando cuenta..." />}
      <div className="cuentas-panel">
        <div className="cuentas-header">
          <div>
            <h2>Cuentas bancarias</h2>
            <p>Agrega o actualiza cuentas con banco, nombre y saldo.</p>
          </div>
          <button className="cuentas-close" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <form className="cuentas-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="banco">Banco</label>
            <input
              id="banco"
              name="banco"
              type="text"
              value={formValues.banco}
              onChange={handleChange}
              placeholder="Nombre del banco"
            />
          </div>

          <div className="form-group">
            <label htmlFor="nombre">Nombre de la cuenta</label>
            <input
              id="nombre"
              name="nombre"
              type="text"
              value={formValues.nombre}
              onChange={handleChange}
              placeholder="Ej. Cuenta corriente"
            />
          </div>

          <div className="form-group">
            <label htmlFor="saldo">Saldo</label>
            <input
  id="saldo"
  name="saldo"
  type="text"
  inputMode="numeric"
  value={formValues.saldo}
  onChange={handleChange}
  placeholder="0"
/>
          </div>

          <button className="cuentas-submit" type="submit">
            {editingId ? "Actualizar cuenta" : "Crear cuenta"}
          </button>
        </form>

        <div className="cuentas-list">
          <h3>Lista de cuentas</h3>
          {accounts.length === 0 ? (
            <p>No hay cuentas registradas aún.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Banco</th>
                  <th>Nombre</th>
                  <th>Saldo</th>
                  <th>Predeterminada</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.banco}</td>
                    <td>{account.nombre}</td>
                    <td>${Number(account.saldo || 0).toLocaleString("es-CO")}</td>
                    <td>
                      <button
                        className={`cuentas-default ${account.esDefault ? "cuentas-default--active" : ""}`}
                        type="button"
                        onClick={() => handleSetDefault(account)}
                        title={account.esDefault ? "Es la cuenta predeterminada" : "Establecer como predeterminada"}
                      >
                        {account.esDefault ? "✓" : "○"}
                      </button>
                    </td>
                    <td>
                      <button
                        className="cuentas-edit"
                        type="button"
                        onClick={() => handleEdit(account)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default Cuentas;
