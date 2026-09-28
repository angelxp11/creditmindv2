import React, { useEffect, useState } from "react";
import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { auth, db } from "../../../server/api";
import Loading from "../../../resources/loading/loading";
import { showToast } from "../../../resources/toastcontainer/ToastContainer";
import { formatObligationDate, formatObligationSchedule, getLocalDateString } from "./obligationUtils";
import "./obligaciones.css";

const initialForm = () => ({
	nombre: "",
	valor: "",
	cuentaId: "",
	frecuencia: "mensual",
	fechaProximoPago: getLocalDateString(),
	fechaPrimerPago: "",
	fechaSegundoPago: "",
});

const formatMoneyInput = (value) => {
	const digits = value.replace(/\D/g, "");
	return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const Obligaciones = ({ isOpen, onClose }) => {
	const [form, setForm] = useState(initialForm);
	const [accounts, setAccounts] = useState([]);
	const [obligations, setObligations] = useState([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!isOpen) return;

		const fetchData = async () => {
			const user = auth.currentUser;
			if (!user) return;

			setLoading(true);
			try {
				const [accountsSnapshot, obligationsSnapshot] = await Promise.all([
					getDocs(query(collection(db, "cuentas"), where("usuarioId", "==", user.uid))),
					getDocs(query(collection(db, "obligaciones"), where("usuarioId", "==", user.uid))),
				]);
				setAccounts(accountsSnapshot.docs
					.map((accountDoc) => ({ id: accountDoc.id, ...accountDoc.data() }))
					.filter((account) => (account.tipoCuenta || "gastos") === "gastos"));
				setObligations(obligationsSnapshot.docs
					.map((obligationDoc) => ({ id: obligationDoc.id, ...obligationDoc.data() }))
					.sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago))));
			} catch (error) {
				console.error("Error cargando obligaciones:", error);
				showToast("No se pudieron cargar las obligaciones", "error");
			} finally {
				setLoading(false);
			}
		};

		setForm(initialForm());
		fetchData();
	}, [isOpen]);

	const handleSubmit = async (event) => {
		event.preventDefault();
		const user = auth.currentUser;
		const account = accounts.find((item) => item.id === form.cuentaId);
		const amount = Number(form.valor.replace(/\./g, ""));
		const name = form.nombre.trim().toUpperCase();
		const firstPaymentDate = form.frecuencia === "quincenal"
			? form.fechaPrimerPago
			: form.fechaProximoPago;
		const secondPaymentDate = form.fechaSegundoPago;

		if (!user) {
			showToast("Necesitas iniciar sesión", "error");
			return;
		}
		if (!account) {
			showToast("Selecciona una cuenta para esta obligación", "error");
			return;
		}
		if (!name || !amount || !firstPaymentDate) {
			showToast("Completa todos los datos de la obligación", "error");
			return;
		}
		if (form.frecuencia === "quincenal") {
			const firstDay = Number(firstPaymentDate.slice(-2));
			const secondDay = Number(secondPaymentDate.slice(-2));
			if (!secondPaymentDate || firstPaymentDate.slice(0, 7) !== secondPaymentDate.slice(0, 7) || firstDay >= secondDay) {
				showToast("Selecciona dos fechas del mismo mes; el segundo pago debe ser posterior al primero", "error");
				return;
			}
		}

		setLoading(true);
		try {
			const obligationData = {
				usuarioId: user.uid,
				nombre: name,
				valor: amount,
				cuentaId: account.id,
				cuentaBanco: account.banco || "",
				cuentaNombre: account.nombre || "",
				frecuencia: form.frecuencia,
				fechaProximoPago: firstPaymentDate,
				diaVencimiento: Number(firstPaymentDate.slice(-2)),
				diaSegundoPago: form.frecuencia === "quincenal" ? Number(secondPaymentDate.slice(-2)) : null,
				proximoPagoNumero: 1,
				activa: true,
				fechaCreacion: serverTimestamp(),
			};
			const obligationRef = await addDoc(collection(db, "obligaciones"), obligationData);
			setObligations((current) => [...current, { id: obligationRef.id, ...obligationData }]
				.sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago))));
			setForm(initialForm());
			showToast("Obligación registrada", "success");
		} catch (error) {
			console.error("Error guardando obligación:", error);
			showToast("No se pudo registrar la obligación", "error");
		} finally {
			setLoading(false);
		}
	};

	const toggleActive = async (obligation) => {
		setLoading(true);
		try {
			await updateDoc(doc(db, "obligaciones", obligation.id), { activa: !obligation.activa });
			setObligations((current) => current.map((item) => item.id === obligation.id
				? { ...item, activa: !item.activa }
				: item));
			showToast(obligation.activa ? "Obligación pausada" : "Obligación reactivada", "success");
		} catch (error) {
			console.error("Error actualizando obligación:", error);
			showToast("No se pudo actualizar la obligación", "error");
		} finally {
			setLoading(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div className="obligaciones-page">
			{loading && <Loading message="Actualizando obligaciones..." />}
			<main className="obligaciones-panel">
				<header className="obligaciones-header">
					<div>
						<span className="obligaciones-eyebrow">Pagos recurrentes</span>
						<h1>Obligaciones</h1>
						<p>Registra pagos fijos y lleva el control de cada vencimiento.</p>
					</div>
					<button className="obligaciones-close" type="button" onClick={onClose}>Cerrar</button>
				</header>

				<form className="obligaciones-form" onSubmit={handleSubmit}>
					<label>
						<span>Nombre</span>
						<input required value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value.toUpperCase() }))} placeholder="Arriendo" />
					</label>
					<label>
						<span>Valor del pago</span>
						<input required type="text" inputMode="numeric" pattern="[0-9.]+" value={form.valor} onChange={(event) => setForm((current) => ({ ...current, valor: formatMoneyInput(event.target.value) }))} placeholder="500.000" />
					</label>
					<label>
						<span>Cuenta para pagar</span>
						<select required value={form.cuentaId} onChange={(event) => setForm((current) => ({ ...current, cuentaId: event.target.value }))}>
							<option value="">Selecciona una cuenta</option>
							{accounts.map((account) => (
								<option key={account.id} value={account.id}>{account.banco} · {account.nombre}</option>
							))}
						</select>
					</label>
					<label>
						<span>Frecuencia</span>
						<select value={form.frecuencia} onChange={(event) => setForm((current) => ({ ...current, frecuencia: event.target.value }))}>
							<option value="mensual">Mensual</option>
							<option value="quincenal">Quincenal (cada 15 días)</option>
						</select>
					</label>
					{form.frecuencia === "quincenal" ? (
						<>
							<label>
								<span>Fecha del primer pago</span>
								<input required type="date" value={form.fechaPrimerPago} onChange={(event) => setForm((current) => ({ ...current, fechaPrimerPago: event.target.value }))} />
							</label>
							<label>
								<span>Fecha del segundo pago</span>
								<input required type="date" value={form.fechaSegundoPago} onChange={(event) => setForm((current) => ({ ...current, fechaSegundoPago: event.target.value }))} />
							</label>
						</>
					) : (
						<label>
							<span>Próximo vencimiento</span>
							<input required type="date" value={form.fechaProximoPago} onChange={(event) => setForm((current) => ({ ...current, fechaProximoPago: event.target.value }))} />
						</label>
					)}
					<button className="obligaciones-submit" type="submit" disabled={loading || accounts.length === 0}>
						Registrar obligación
					</button>
					{accounts.length === 0 && <p className="obligaciones-hint">Primero necesitas una cuenta de gastos para pagar obligaciones.</p>}
				</form>

				<section className="obligaciones-list" aria-labelledby="obligaciones-list-title">
					<div className="obligaciones-list__heading">
						<h2 id="obligaciones-list-title">Tus obligaciones</h2>
						<span>{obligations.length}</span>
					</div>
					{obligations.length === 0 ? (
						<p className="obligaciones-empty">Todavía no has registrado obligaciones.</p>
					) : obligations.map((obligation) => (
						<article className={`obligacion-row${obligation.activa ? "" : " obligacion-row--paused"}`} key={obligation.id}>
							<div className="obligacion-row__details">
								<strong>{obligation.nombre}</strong>
								<span>${Number(obligation.valor || 0).toLocaleString("es-CO")} · {formatObligationSchedule(obligation)} · {obligation.cuentaNombre}</span>
								{obligation.fechaUltimoPeriodoPagado && (
									<span>Periodo cubierto: {formatObligationDate(obligation.fechaUltimoPeriodoPagado)}</span>
								)}
								<span>{obligation.activa ? "Próximo vencimiento" : "Pausada"}: {formatObligationDate(obligation.fechaProximoPago)}</span>
							</div>
							<button type="button" onClick={() => toggleActive(obligation)} disabled={loading}>
								{obligation.activa ? "Pausar" : "Reactivar"}
							</button>
						</article>
					))}
				</section>
			</main>
		</div>
	);
};

export default Obligaciones;
