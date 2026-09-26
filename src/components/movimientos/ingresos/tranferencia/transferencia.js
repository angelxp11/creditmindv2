import React, { useEffect, useState } from "react";
import { auth, db } from "../../../../server/api";
import {
	collection,
	doc,
	onSnapshot,
	query,
	runTransaction,
	serverTimestamp,
	where,
} from "firebase/firestore";
import Loading from "../../../../resources/loading/loading";
import { showToast } from "../../../../resources/toastcontainer/ToastContainer";
import "./transferencia.css";

const initialForm = { valor: "", descripcion: "", persona: "" };

const formatMoney = (value) =>
	String(Math.abs(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const Transferencia = ({ isOpen, onClose }) => {
	const [accounts, setAccounts] = useState([]);
	const [sourceAccountId, setSourceAccountId] = useState("");
	const [destinationAccountId, setDestinationAccountId] = useState("");
	const [transferMode, setTransferMode] = useState("cuentas");
	const [formValues, setFormValues] = useState(initialForm);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!isOpen) return undefined;

		const user = auth.currentUser;
		if (!user) return undefined;

		setSourceAccountId("");
		setDestinationAccountId("");
		setTransferMode("cuentas");
		setFormValues(initialForm);
		setLoading(true);

		const accountsQuery = query(
			collection(db, "cuentas"),
			where("usuarioId", "==", user.uid)
		);
		return onSnapshot(accountsQuery, (snapshot) => {
			setAccounts(snapshot.docs.map((accountDoc) => ({
				id: accountDoc.id,
				...accountDoc.data(),
			})));
			setLoading(false);
		}, (error) => {
			console.error("Error cargando cuentas para transferir:", error);
			showToast("No se pudieron cargar las cuentas", "error");
			setLoading(false);
		});
	}, [isOpen]);

	const handleChange = (event) => {
		const { name, value } = event.target;
		if (name === "valor") {
			const digits = value.replace(/\D/g, "");
			setFormValues((previous) => ({
				...previous,
				valor: digits.replace(/\B(?=(\d{3})+(?!\d))/g, "."),
			}));
			return;
		}
		setFormValues((previous) => ({
			...previous,
			[name]: name === "descripcion" || name === "persona" ? value.toUpperCase() : value,
		}));
	};

	const handleSubmit = async (event) => {
		event.preventDefault();
		const user = auth.currentUser;
		const valor = Number(formValues.valor.replace(/\./g, ""));
		const source = accounts.find((account) => account.id === sourceAccountId);
		const destination = transferMode === "cuentas"
			? accounts.find((account) => account.id === destinationAccountId)
			: null;
		const persona = formValues.persona.trim();
		const descripcion = formValues.descripcion.trim();

		if (!user) { showToast("Necesitas iniciar sesión", "error"); return; }
		if (!source) { showToast("Selecciona una cuenta de origen", "error"); return; }
		if (transferMode === "cuentas" && !destination) { showToast("Selecciona una cuenta de destino", "error"); return; }
		if (destination && source.id === destination.id) { showToast("El origen y el destino deben ser diferentes", "error"); return; }
		if (transferMode === "persona" && (!persona || !descripcion)) {
			showToast("Indica la persona y el motivo de la transferencia", "error");
			return;
		}
		if (!Number.isSafeInteger(valor) || valor <= 0) { showToast("Ingresa un valor válido", "error"); return; }
		if (valor > Number(source.saldo || 0)) { showToast("Saldo insuficiente en la cuenta de origen", "error"); return; }

		setLoading(true);
		try {
			const sourceRef = doc(db, "cuentas", source.id);
			const destinationRef = destination ? doc(db, "cuentas", destination.id) : null;
			const movementRef = doc(collection(db, "movimientos"));

			await runTransaction(db, async (transaction) => {
				const sourceSnapshot = await transaction.get(sourceRef);
				const destinationSnapshot = destinationRef
					? await transaction.get(destinationRef)
					: null;
				if (!sourceSnapshot.exists() || (destinationSnapshot && !destinationSnapshot.exists())) {
					throw new Error("CUENTA_NO_ENCONTRADA");
				}

				const sourceData = sourceSnapshot.data();
				const destinationData = destinationSnapshot?.data();
				const sourceBalance = Number(sourceData.saldo || 0);
				if (valor > sourceBalance) throw new Error("SALDO_INSUFICIENTE");

				transaction.update(sourceRef, {
					saldo: sourceBalance - valor,
					ultimaActualizacion: serverTimestamp(),
				});
				if (destinationRef && destinationData) {
					transaction.update(destinationRef, {
						saldo: Number(destinationData.saldo || 0) + valor,
						ultimaActualizacion: serverTimestamp(),
					});
				}
				transaction.set(movementRef, {
					userId: user.uid,
					usuarioId: user.uid,
					cuentaId: source.id,
					cuentaBanco: sourceData.banco,
					cuentaNombre: sourceData.nombre,
					...(destinationData ? {
						cuentaDestinoId: destination.id,
						cuentaDestinoBanco: destinationData.banco,
						cuentaDestinoNombre: destinationData.nombre,
					} : {
						tipoTransferencia: "externa",
						destinatarioNombre: persona.toUpperCase(),
					}),
					tipo: "transferencia",
					valor,
						descripcion: descripcion.toUpperCase() || "TRANSFERENCIA",
					fechaHora: new Date(),
					fechaCreacion: serverTimestamp(),
				});
			});

			showToast("Transferencia registrada correctamente", "success");
			setFormValues(initialForm);
			setSourceAccountId("");
			setDestinationAccountId("");
		} catch (error) {
			console.error("Error registrando transferencia:", error);
			showToast(
				error.message === "SALDO_INSUFICIENTE"
					? "Saldo insuficiente en la cuenta de origen"
					: "No se pudo registrar la transferencia",
				"error"
			);
		} finally {
			setLoading(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div className="transfer-page">
			{loading && <Loading message="Actualizando transferencia..." />}
			<section className="transfer-panel">
				<header className="transfer-header">
					<div>
						<h2>Transferir dinero</h2>
						<p>Mueve dinero entre tus cuentas o envíalo a otra persona.</p>
					</div>
					<button className="transfer-close" type="button" onClick={onClose}>Cerrar</button>
				</header>

				<div className="transfer-mode" role="tablist" aria-label="Tipo de transferencia">
					<button
						type="button"
						role="tab"
						aria-selected={transferMode === "cuentas"}
						className={transferMode === "cuentas" ? "transfer-mode__button is-active" : "transfer-mode__button"}
						onClick={() => { setTransferMode("cuentas"); setDestinationAccountId(""); }}
					>
						Entre mis cuentas
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={transferMode === "persona"}
						className={transferMode === "persona" ? "transfer-mode__button is-active" : "transfer-mode__button"}
						onClick={() => { setTransferMode("persona"); setDestinationAccountId(""); }}
					>
						A otra persona
					</button>
				</div>

				<form className="transfer-form" onSubmit={handleSubmit}>
					<div className="transfer-field">
						<label htmlFor="transfer-source">Desde</label>
						<select id="transfer-source" value={sourceAccountId} onChange={(event) => setSourceAccountId(event.target.value)}>
							<option value="">Selecciona cuenta de origen</option>
							{accounts.map((account) => (
								<option key={account.id} value={account.id}>
									{account.banco} - {account.nombre} (${formatMoney(account.saldo)})
								</option>
							))}
						</select>
					</div>

					{transferMode === "cuentas" ? (
						<div className="transfer-field">
							<label htmlFor="transfer-destination">Hacia</label>
							<select id="transfer-destination" value={destinationAccountId} onChange={(event) => setDestinationAccountId(event.target.value)}>
								<option value="">Selecciona cuenta de destino</option>
								{accounts.filter((account) => account.id !== sourceAccountId).map((account) => (
									<option key={account.id} value={account.id}>
										{account.banco} - {account.nombre} (${formatMoney(account.saldo)})
									</option>
								))}
							</select>
						</div>
					) : (
						<div className="transfer-field">
							<label htmlFor="transfer-person">Persona</label>
							<input
								id="transfer-person"
								name="persona"
								type="text"
								placeholder="Nombre de quien recibe"
								value={formValues.persona}
								onChange={handleChange}
								required
							/>
						</div>
					)}

					<div className="transfer-field">
						<label htmlFor="transfer-value">Valor</label>
						<input
							id="transfer-value"
							name="valor"
							type="text"
							inputMode="numeric"
							placeholder="0"
							value={formValues.valor}
							onChange={handleChange}
						/>
					</div>

					<div className="transfer-field">
						<label htmlFor="transfer-description">
							{transferMode === "persona" ? "Motivo" : "Descripción (opcional)"}
						</label>
						<input
							id="transfer-description"
							name="descripcion"
							type="text"
							placeholder={transferMode === "persona" ? "Ej. Pago de préstamo" : "Ej. Ahorro mensual"}
							value={formValues.descripcion}
							onChange={handleChange}
							required={transferMode === "persona"}
						/>
					</div>

					<button className="transfer-submit" type="submit" disabled={loading || accounts.length < (transferMode === "cuentas" ? 2 : 1)}>
						{transferMode === "persona" ? "Enviar transferencia" : "Transferir"}
					</button>
					{accounts.length < (transferMode === "cuentas" ? 2 : 1) && !loading && (
						<p className="transfer-hint">
							{transferMode === "cuentas"
								? "Necesitas al menos dos cuentas para transferir dinero."
								: "Necesitas al menos una cuenta para enviar dinero."}
						</p>
					)}
				</form>
			</section>
		</div>
	);
};

export default Transferencia;
