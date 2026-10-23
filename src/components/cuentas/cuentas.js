import React, { useEffect, useState } from "react";
import { auth, db } from "../../server/api";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  doc,
} from "firebase/firestore";
import Loading from "../../resources/loading/loading";
import { showToast } from "../../resources/toastcontainer/ToastContainer";
import { ACCOUNT_CARD_OPTIONS, getAccountCardImage, getAccountCardKey } from "../../resources/imagenes/tarjetas/accountCard";
import "./cuentas.css";

const initialForm = {
  banco: "",
  nombre: "",
  namewallet: "",
  saldo: "",
  limiteCredito: "",
  deudaActual: "",
  fechaCorte: "",
  fechaLimitePago: "",
  tasaInteresMensual: "",
  tasaEfectivaAnual: "",
  cargoAvance: "",
  maximoCuotasAvance: "",
  tipoCuenta: "gastos",
  imagenTarjeta: "debito",
};

const sanitizeRateInput = (value) => {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const decimalIndex = normalized.indexOf(".");
  if (decimalIndex === -1) return normalized;
  return `${normalized.slice(0, decimalIndex)}.${normalized.slice(decimalIndex + 1).replace(/\./g, "").slice(0, 4)}`;
};

const Cuentas = ({ isOpen, onClose }) => {
  const [accounts, setAccounts] = useState([]);
  const [formValues, setFormValues] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [liquidationAccountId, setLiquidationAccountId] = useState("");
  const [liquidationDestinationId, setLiquidationDestinationId] = useState("");
  const [liquidationAmount, setLiquidationAmount] = useState("");

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

  if (["saldo", "limiteCredito", "deudaActual", "cargoAvance"].includes(name)) {
    const soloNumeros = value.replace(/\D/g, "");

    const formateado = soloNumeros.replace(
      /\B(?=(\d{3})+(?!\d))/g,
      "."
    );

    setFormValues((prev) => ({
      ...prev,
      [name]: formateado,
    }));

    return;
  }

  if (["fechaCorte", "fechaLimitePago"].includes(name)) {
    setFormValues((prev) => ({
      ...prev,
      [name]: value.replace(/\D/g, "").slice(0, 2),
    }));
    return;
  }

  if (name === "maximoCuotasAvance") {
    setFormValues((prev) => ({
      ...prev,
      [name]: value.replace(/\D/g, ""),
    }));
    return;
  }

  if (["tasaInteresMensual", "tasaEfectivaAnual"].includes(name)) {
    setFormValues((prev) => ({
      ...prev,
      [name]: sanitizeRateInput(value),
    }));
    return;
  }

  setFormValues((prev) => ({
    ...prev,
    [name]: value,
    ...(name === "tipoCuenta" ? { imagenTarjeta: getAccountCardKey(value) } : {}),
  }));
};

  

  

  const handleSubmit = async (event) => {
    event.preventDefault();
    const banco = formValues.banco.trim();
    const nombre = formValues.nombre.trim();
    const namewallet = formValues.namewallet.trim();
    const tipoCuenta = formValues.tipoCuenta;
    const isCreditAccount = tipoCuenta === "credito";
    const limiteCredito = Number((formValues.limiteCredito || "").replace(/\./g, ""));
    const deudaActual = Number((formValues.deudaActual || "").replace(/\./g, ""));
    const fechaCorte = Number(formValues.fechaCorte);
    const fechaLimitePago = Number(formValues.fechaLimitePago);
    const tasaInteresMensual = Number(formValues.tasaInteresMensual);
    const tasaEfectivaAnual = Number(formValues.tasaEfectivaAnual);
    const cargoAvance = Number((formValues.cargoAvance || "").replace(/\./g, ""));
    const maximoCuotasAvance = Number(formValues.maximoCuotasAvance);
    const imagenTarjeta = ACCOUNT_CARD_OPTIONS.some((option) => option.key === formValues.imagenTarjeta)
      ? formValues.imagenTarjeta
      : getAccountCardKey(tipoCuenta);
    const saldo = isCreditAccount
      ? limiteCredito - deudaActual
      : Number((formValues.saldo || "").replace(/\./g, ""));
    const user = auth.currentUser;

    if (!user) {
      showToast("No hay un usuario autenticado", "error");
      return;
    }

    if (!banco || !nombre || !["gastos", "ahorros", "credito"].includes(tipoCuenta) || Number.isNaN(saldo)) {
      showToast("Completa todos los datos correctamente", "error");
      return;
    }
    if (isCreditAccount && (limiteCredito <= 0 || deudaActual < 0 || deudaActual > limiteCredito)) {
      showToast("El cupo debe ser mayor a cero y la deuda no puede superar el cupo", "error");
      return;
    }
    if (isCreditAccount && (
      !Number.isInteger(fechaCorte) || fechaCorte < 1 || fechaCorte > 31 ||
      !Number.isInteger(fechaLimitePago) || fechaLimitePago < 1 || fechaLimitePago > 31 ||
      formValues.tasaInteresMensual === "" || !Number.isFinite(tasaInteresMensual) || tasaInteresMensual < 0 ||
      formValues.tasaEfectivaAnual === "" || !Number.isFinite(tasaEfectivaAnual) || tasaEfectivaAnual < 0 ||
      formValues.cargoAvance === "" || !Number.isSafeInteger(cargoAvance) || cargoAvance < 0 ||
      formValues.maximoCuotasAvance === "" || !Number.isSafeInteger(maximoCuotasAvance) || maximoCuotasAvance < 1
    )) {
      showToast("Completa los días, tasas, cargo por avance y máximo de cuotas correctamente", "error");
      return;
    }

    const creditTerms = {
      limiteCredito: isCreditAccount ? limiteCredito : null,
      deudaActual: isCreditAccount ? deudaActual : null,
      fechaCorte: isCreditAccount ? fechaCorte : null,
      fechaLimitePago: isCreditAccount ? fechaLimitePago : null,
      tasaInteresMensual: isCreditAccount ? tasaInteresMensual : null,
      tasaEfectivaAnual: isCreditAccount ? tasaEfectivaAnual : null,
      cargoAvance: isCreditAccount ? cargoAvance : null,
      maximoCuotasAvance: isCreditAccount ? maximoCuotasAvance : null,
    };

    setLoading(true);

    try {
      if (editingId) {
        const accountRef = doc(db, "cuentas", editingId);
        await updateDoc(accountRef, {
          banco,
          nombre,
          namewallet,
          saldo,
          tipoCuenta,
          ...creditTerms,
          imagenTarjeta,
          ultimaActualizacion: serverTimestamp(),
        });

        setAccounts((prev) =>
          prev.map((account) =>
            account.id === editingId
              ? { ...account, banco, nombre, namewallet, saldo, tipoCuenta, ...creditTerms, imagenTarjeta }
              : account
          )
        );
        showToast("Cuenta actualizada correctamente", "success");
      } else {
        const docRef = await addDoc(collection(db, "cuentas"), {
          banco,
          nombre,
          namewallet,
          saldo,
          tipoCuenta,
          ...creditTerms,
          imagenTarjeta,
          usuarioId: user.uid,
          fechaCreacion: serverTimestamp(),
          ultimaActualizacion: serverTimestamp(),
        });

        setAccounts((prev) => [
          {
            id: docRef.id,
            banco,
            nombre,
            namewallet,
            saldo,
            tipoCuenta,
            ...creditTerms,
            imagenTarjeta,
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
  namewallet: account.namewallet || "",
    saldo: account.tipoCuenta === "credito" ? "" : Number(account.saldo || 0).toLocaleString("es-CO"),
    limiteCredito: account.tipoCuenta === "credito" ? Number(account.limiteCredito || account.saldo || 0).toLocaleString("es-CO") : "",
    deudaActual: account.tipoCuenta === "credito" ? Number(account.deudaActual || 0).toLocaleString("es-CO") : "",
    fechaCorte: account.fechaCorte || "",
    fechaLimitePago: account.fechaLimitePago || "",
    tasaInteresMensual: account.tasaInteresMensual ?? "",
    tasaEfectivaAnual: account.tasaEfectivaAnual ?? "",
    cargoAvance: account.cargoAvance === null || account.cargoAvance === undefined
      ? ""
      : Number(account.cargoAvance).toLocaleString("es-CO"),
    maximoCuotasAvance: account.maximoCuotasAvance ?? "",
  tipoCuenta: account.tipoCuenta || "gastos",
    imagenTarjeta: account.imagenTarjeta || getAccountCardKey(account.tipoCuenta),
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

  const handleOpenLiquidation = (account) => {
    const destinations = accounts.filter(
      (candidate) => candidate.id !== account.id && candidate.tipoCuenta !== "credito"
    );
    setLiquidationAccountId(account.id);
    setLiquidationDestinationId(destinations[0]?.id || "");
    setLiquidationAmount(Number(account.saldo || 0).toLocaleString("es-CO"));
  };

  const handleLiquidateSavings = async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    const receivedAmount = Number(liquidationAmount.replace(/\./g, ""));
    const source = accounts.find((account) => account.id === liquidationAccountId);
    const destination = accounts.find((account) => account.id === liquidationDestinationId);

    if (!user) {
      showToast("No hay un usuario autenticado", "error");
      return;
    }
    if (!source || source.tipoCuenta !== "ahorros") {
      showToast("Selecciona una alcancía válida", "error");
      return;
    }
    if (!destination || destination.id === source.id || destination.tipoCuenta === "credito") {
      showToast("Selecciona una cuenta de destino válida", "error");
      return;
    }
    if (!Number.isSafeInteger(receivedAmount) || receivedAmount <= 0) {
      showToast("Ingresa el valor total recibido, incluidos los intereses", "error");
      return;
    }

    setLoading(true);
    const sourceRef = doc(db, "cuentas", source.id);
    const destinationRef = doc(db, "cuentas", destination.id);
    const movementRef = doc(collection(db, "movimientos"));
    let sourceBalance = 0;
    let destinationBalance = 0;

    try {
      await runTransaction(db, async (transaction) => {
        const sourceSnapshot = await transaction.get(sourceRef);
        const destinationSnapshot = await transaction.get(destinationRef);
        if (!sourceSnapshot.exists() || !destinationSnapshot.exists()) {
          throw new Error("ACCOUNT_UNAVAILABLE");
        }

        const sourceData = sourceSnapshot.data();
        const destinationData = destinationSnapshot.data();
        sourceBalance = Number(sourceData.saldo || 0);
        destinationBalance = Number(destinationData.saldo || 0);
        if (
          sourceData.usuarioId !== user.uid ||
          sourceData.tipoCuenta !== "ahorros" ||
          destinationData.usuarioId !== user.uid ||
          destinationData.tipoCuenta === "credito"
        ) {
          throw new Error("ACCOUNT_UNAVAILABLE");
        }
        if (!Number.isSafeInteger(sourceBalance) || sourceBalance <= 0) {
          throw new Error("EMPTY_SAVINGS");
        }
        if (!Number.isSafeInteger(destinationBalance + receivedAmount)) {
          throw new Error("INVALID_DESTINATION_BALANCE");
        }

        transaction.update(sourceRef, {
          saldo: 0,
          ultimaActualizacion: serverTimestamp(),
        });
        transaction.update(destinationRef, {
          saldo: destinationBalance + receivedAmount,
          ultimaActualizacion: serverTimestamp(),
        });
        transaction.set(movementRef, {
          userId: user.uid,
          usuarioId: user.uid,
          cuentaId: source.id,
          cuentaBanco: sourceData.banco || "",
          cuentaNombre: sourceData.nombre || "",
          cuentaDestinoId: destination.id,
          cuentaDestinoBanco: destinationData.banco || "",
          cuentaDestinoNombre: destinationData.nombre || "",
          tipo: "transferencia",
          origen: "liquidacion_alcancia",
          valor: sourceBalance,
          valorDestino: receivedAmount,
          descripcion: "LIQUIDACIÓN DE ALCANCÍA (INCLUYE INTERESES)",
          fechaHora: new Date(),
          fechaCreacion: serverTimestamp(),
        });
      });

      setAccounts((current) => current.map((account) => {
        if (account.id === source.id) return { ...account, saldo: 0 };
        if (account.id === destination.id) {
          return { ...account, saldo: destinationBalance + receivedAmount };
        }
        return account;
      }));
      setLiquidationAccountId("");
      setLiquidationDestinationId("");
      setLiquidationAmount("");
      showToast("Alcancía liquidada y dinero transferido correctamente", "success");
    } catch (error) {
      console.error("Error liquidando alcancía:", error);
      if (error.message === "EMPTY_SAVINGS") {
        showToast("La alcancía no tiene saldo para liquidar", "error");
      } else if (error.message === "ACCOUNT_UNAVAILABLE") {
        showToast("La alcancía o la cuenta de destino ya no está disponible", "error");
      } else if (error.message === "INVALID_DESTINATION_BALANCE") {
        showToast("El saldo de la cuenta de destino excede el valor permitido", "error");
      } else {
        showToast("No se pudo liquidar la alcancía", "error");
      }
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
            <label htmlFor="namewallet">Nombre que aparece en Wallet</label>
            <input
              id="namewallet"
              name="namewallet"
              type="text"
              value={formValues.namewallet}
              onChange={handleChange}
              placeholder="Ej. BANCO · VISA DORADA"
            />
          </div>

          {formValues.tipoCuenta === "credito" ? (
            <>
              <div className="form-group">
                <label htmlFor="limiteCredito">Cupo total</label>
                <input id="limiteCredito" name="limiteCredito" type="text" inputMode="numeric" value={formValues.limiteCredito} onChange={handleChange} placeholder="5.000.000" />
              </div>
              <div className="form-group">
                <label htmlFor="deudaActual">Deuda actual</label>
                <input id="deudaActual" name="deudaActual" type="text" inputMode="numeric" value={formValues.deudaActual} onChange={handleChange} placeholder="0" />
              </div>
              <div className="cuentas-credit-terms">
                <div className="form-group">
                  <label htmlFor="fechaCorte">Día de corte (del mes)</label>
                  <input id="fechaCorte" name="fechaCorte" type="text" inputMode="numeric" pattern="[0-9]{1,2}" maxLength="2" required value={formValues.fechaCorte} onChange={handleChange} placeholder="15" />
                </div>
                <div className="form-group">
                  <label htmlFor="fechaLimitePago">Día límite de pago</label>
                  <input id="fechaLimitePago" name="fechaLimitePago" type="text" inputMode="numeric" pattern="[0-9]{1,2}" maxLength="2" required value={formValues.fechaLimitePago} onChange={handleChange} placeholder="5" />
                </div>
                <div className="form-group">
                  <label htmlFor="tasaInteresMensual">Tasa mensual (%)</label>
                  <input id="tasaInteresMensual" name="tasaInteresMensual" type="text" inputMode="decimal" pattern="([0-9]+([.][0-9]{0,4})?|[.][0-9]{1,4})" required value={formValues.tasaInteresMensual} onChange={handleChange} placeholder="2.00" />
                </div>
                <div className="form-group">
                  <label htmlFor="tasaEfectivaAnual">Tasa efectiva anual (%)</label>
                  <input id="tasaEfectivaAnual" name="tasaEfectivaAnual" type="text" inputMode="decimal" pattern="([0-9]+([.][0-9]{0,4})?|[.][0-9]{1,4})" required value={formValues.tasaEfectivaAnual} onChange={handleChange} placeholder="26.82" />
                </div>
                <div className="form-group">
                  <label htmlFor="cargoAvance">Valor del avance (cargo adicional)</label>
                  <input id="cargoAvance" name="cargoAvance" type="text" inputMode="numeric" required value={formValues.cargoAvance} onChange={handleChange} placeholder="0" />
                </div>
                <div className="form-group">
                  <label htmlFor="maximoCuotasAvance">Máximo de cuotas para avances</label>
                  <input id="maximoCuotasAvance" name="maximoCuotasAvance" type="text" inputMode="numeric" pattern="[0-9]+" required value={formValues.maximoCuotasAvance} onChange={handleChange} placeholder="36" />
                </div>
              </div>
            </>
          ) : (
            <div className="form-group">
              <label htmlFor="saldo">Saldo</label>
              <input id="saldo" name="saldo" type="text" inputMode="numeric" value={formValues.saldo} onChange={handleChange} placeholder="0" />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="tipoCuenta">Tipo de cuenta</label>
            <select
              id="tipoCuenta"
              name="tipoCuenta"
              value={formValues.tipoCuenta}
              onChange={handleChange}
            >
              <option value="gastos">Cuenta de gastos</option>
              <option value="ahorros">Cuenta de ahorros</option>
              <option value="credito">Tarjeta de crédito</option>
            </select>
          </div>

          {formValues.tipoCuenta === "credito" && (
            <p className="cuentas-credit-available">
              Cupo disponible: ${Math.max(0, Number((formValues.limiteCredito || "").replace(/\./g, "")) - Number((formValues.deudaActual || "").replace(/\./g, ""))).toLocaleString("es-CO")}
            </p>
          )}

          <div className="cuentas-card-picker">
            <span className="cuentas-card-picker__label">Imagen de la tarjeta</span>
            <div className="cuentas-card-picker__options" role="radiogroup" aria-label="Imagen de la tarjeta">
              {ACCOUNT_CARD_OPTIONS.map((option) => (
                <button
                  className={`cuentas-card-option${formValues.imagenTarjeta === option.key ? " cuentas-card-option--selected" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={formValues.imagenTarjeta === option.key}
                  key={option.key}
                  onClick={() => setFormValues((current) => ({ ...current, imagenTarjeta: option.key }))}
                >
                  <img src={option.image} alt="" />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
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
                  <th>Nombre en Wallet</th>
                  <th>Saldo disponible</th>
                  <th>Deuda / cupo</th>
                  <th>Tarjeta</th>
                  <th>Tipo</th>
                  <th>Predeterminada</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.banco}</td>
                    <td>{account.nombre}</td>
                    <td>{account.namewallet || "—"}</td>
                    <td>${Number(account.saldo || 0).toLocaleString("es-CO")}</td>
                    <td>{account.tipoCuenta === "credito"
                      ? `$${Number(account.deudaActual || 0).toLocaleString("es-CO")} / $${Number(account.limiteCredito || 0).toLocaleString("es-CO")}`
                      : "—"}</td>
                    <td>
                      <img
                        className="cuentas-card-preview"
                        src={getAccountCardImage(account)}
                        alt={`Tarjeta de ${account.nombre}`}
                        loading="lazy"
                      />
                    </td>
                    <td>
                      <span className={`cuentas-type cuentas-type--${account.tipoCuenta || "gastos"}`}>
                        {account.tipoCuenta === "ahorros" ? "Ahorros" : account.tipoCuenta === "credito" ? "Crédito" : "Gastos"}
                      </span>
                    </td>
                    <td>
                      <button
                        className={`cuentas-default ${account.esDefault ? "cuentas-default--active" : ""}`}
                        type="button"
                        disabled={account.tipoCuenta === "credito"}
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
                      {account.tipoCuenta === "ahorros" && (
                        <button
                          className="cuentas-liquidate"
                          type="button"
                          disabled={loading || Number(account.saldo || 0) <= 0}
                          onClick={() => handleOpenLiquidation(account)}
                        >
                          Liquidar alcancía
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {liquidationAccountId && (
        <div
          className="cuentas-modal-overlay"
          onClick={() => !loading && setLiquidationAccountId("")}
        >
          <form
            className="cuentas-liquidation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="liquidation-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleLiquidateSavings}
          >
            <div className="cuentas-liquidation__header">
              <div>
                <h3 id="liquidation-title">Liquidar alcancía</h3>
                <p>
                  Se transferirá todo el saldo de{" "}
                  <strong>{accounts.find((account) => account.id === liquidationAccountId)?.nombre}</strong>.
                  Ingresa el total recibido, incluidos intereses o cargos.
                </p>
              </div>
              <button
                className="cuentas-liquidation__close"
                type="button"
                aria-label="Cerrar liquidación"
                onClick={() => setLiquidationAccountId("")}
                disabled={loading}
              >
                ×
              </button>
            </div>
            <label className="form-group" htmlFor="liquidationDestination">
              Cuenta de destino
              <select
                id="liquidationDestination"
                required
                value={liquidationDestinationId}
                onChange={(event) => setLiquidationDestinationId(event.target.value)}
              >
                <option value="">Selecciona una cuenta</option>
                {accounts
                  .filter((account) => account.id !== liquidationAccountId && account.tipoCuenta !== "credito")
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.banco} · {account.nombre}
                    </option>
                  ))}
              </select>
            </label>
            <label className="form-group" htmlFor="liquidationAmount">
              Total recibido (incluye intereses)
              <input
                id="liquidationAmount"
                required
                type="text"
                inputMode="numeric"
                value={liquidationAmount}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "");
                  setLiquidationAmount(digits.replace(/\B(?=(\d{3})+(?!\d))/g, "."));
                }}
              />
            </label>
            <div className="cuentas-liquidation__actions">
              <button className="cuentas-submit" type="submit" disabled={loading || !liquidationDestinationId}>
                Confirmar liquidación
              </button>
              <button
                className="cuentas-liquidation__cancel"
                type="button"
                onClick={() => setLiquidationAccountId("")}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Cuentas;
