import React, { useEffect, useState } from "react";
import { addDoc, collection, deleteField, deleteDoc, doc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
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

const getDateForDay = (dateValue, day) => {
	const [year, month] = String(dateValue || getLocalDateString()).slice(0, 7).split("-").map(Number);
	const lastDay = new Date(year, month, 0).getDate();
	const selectedDay = Math.min(Number(day), lastDay);
	return `${year}-${String(month).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
};

const initialIncomeForm = () => ({
	nombre: "",
	valor: "",
	cuentaId: "",
	frecuencia: "mensual",
	fechaProximoPago: getLocalDateString(),
	fechaPrimerPago: "",
	fechaSegundoPago: "",
});

const Obligaciones = ({ isOpen, onClose }) => {
	const [form, setForm] = useState(initialForm);
	const [editingId, setEditingId] = useState("");
	const [accounts, setAccounts] = useState([]);
	const [obligations, setObligations] = useState([]);
	const [incomeForm, setIncomeForm] = useState(initialIncomeForm);
	const [editingIncomeId, setEditingIncomeId] = useState("");
	const [recurringIncomes, setRecurringIncomes] = useState([]);
	const [activeView, setActiveView] = useState("obligations");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!isOpen) return;

		const fetchData = async () => {
			const user = auth.currentUser;
			if (!user) return;

			setLoading(true);
			try {
				const [accountsSnapshot, obligationsSnapshot, incomesSnapshot] = await Promise.all([
					getDocs(query(collection(db, "cuentas"), where("usuarioId", "==", user.uid))),
					getDocs(query(collection(db, "obligaciones"), where("usuarioId", "==", user.uid))),
					getDocs(query(collection(db, "ingresosRecurrentes"), where("usuarioId", "==", user.uid))),
				]);
				setAccounts(accountsSnapshot.docs
					.map((accountDoc) => ({ id: accountDoc.id, ...accountDoc.data() })));
				setObligations(obligationsSnapshot.docs
					.map((obligationDoc) => ({ id: obligationDoc.id, ...obligationDoc.data() }))
					.sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago))));
				setRecurringIncomes(incomesSnapshot.docs
					.map((incomeDoc) => ({ id: incomeDoc.id, ...incomeDoc.data() }))
					.sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago))));
			} catch (error) {
				console.error("Error cargando obligaciones:", error);
				showToast("No se pudieron cargar las obligaciones", "error");
			} finally {
				setLoading(false);
			}
		};

		setForm(initialForm());
		setEditingId("");
		setIncomeForm(initialIncomeForm());
		setEditingIncomeId("");
		setActiveView("obligations");
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
		if (!name || !Number.isSafeInteger(amount) || amount <= 0 || (!editingId && !firstPaymentDate)) {
			showToast("Completa todos los datos de la obligación", "error");
			return;
		}
		if (!editingId && form.frecuencia === "quincenal") {
			const firstDay = Number(firstPaymentDate.slice(-2));
			const secondDay = Number(secondPaymentDate.slice(-2));
			if (!secondPaymentDate || firstPaymentDate.slice(0, 7) !== secondPaymentDate.slice(0, 7) || firstDay >= secondDay) {
				showToast("Selecciona dos fechas del mismo mes; el segundo pago debe ser posterior al primero", "error");
				return;
			}
		}

		setLoading(true);
		try {
				if (editingId) {
					const updatedData = {
						nombre: name,
						valor: amount,
						cuentaId: account.id,
						cuentaBanco: account.banco || "",
						cuentaNombre: account.nombre || "",
						ultimaActualizacion: serverTimestamp(),
					};
					await updateDoc(doc(db, "obligaciones", editingId), updatedData);
					setObligations((current) => current.map((item) =>
						item.id === editingId ? { ...item, ...updatedData } : item
					));
					setEditingId("");
					showToast("Obligación actualizada", "success");
				} else {
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
					showToast("Obligación registrada", "success");
				}
				setForm(initialForm());
		} catch (error) {
			console.error("Error guardando obligación:", error);
			showToast("No se pudo registrar la obligación", "error");
		} finally {
			setLoading(false);
		}
	};

	const editObligation = (obligation) => {
		setActiveView("obligations");
		setEditingId(obligation.id);
		setForm({
			nombre: obligation.nombre || "",
			valor: formatMoneyInput(String(Number(obligation.valor || 0))),
			cuentaId: obligation.cuentaId || "",
			frecuencia: obligation.frecuencia || "mensual",
			fechaProximoPago: obligation.fechaProximoPago || getLocalDateString(),
			fechaPrimerPago: "",
			fechaSegundoPago: "",
		});
	};

	const handleIncomeSubmit = async (event) => {
		event.preventDefault();
		const user = auth.currentUser;
		const account = accounts.find((item) => item.id === incomeForm.cuentaId);
		const amount = Number(incomeForm.valor.replace(/\./g, ""));
		const name = incomeForm.nombre.trim().toUpperCase();
		const nextDueDate = incomeForm.frecuencia === "quincenal"
			? incomeForm.fechaPrimerPago
			: incomeForm.fechaProximoPago;
		const secondPaymentDate = incomeForm.fechaSegundoPago;
		const firstDueDay = Number(nextDueDate.slice(-2));
		const secondDueDay = incomeForm.frecuencia === "quincenal"
			? Number(secondPaymentDate.slice(-2))
			: null;

		if (!user) {
			showToast("Necesitas iniciar sesión", "error");
			return;
		}
		if (!account || account.tipoCuenta === "credito") {
			showToast("Selecciona una cuenta válida para recibir el ingreso", "error");
			return;
		}
		if (!name || !Number.isSafeInteger(amount) || amount <= 0 || !nextDueDate) {
			showToast("Completa los datos del ingreso recurrente", "error");
			return;
		}
		if (incomeForm.frecuencia === "quincenal") {
			const firstDay = Number(nextDueDate.slice(-2));
			const secondDay = Number(secondPaymentDate.slice(-2));
			if (!secondPaymentDate || nextDueDate.slice(0, 7) !== secondPaymentDate.slice(0, 7) || firstDay >= secondDay) {
				showToast("Selecciona dos fechas del mismo mes; la segunda debe ser posterior a la primera", "error");
				return;
			}
		}

		setLoading(true);
		try {
			const incomeData = {
				nombre: name,
				valor: amount,
				cuentaId: account.id,
				cuentaBanco: account.banco || "",
				cuentaNombre: account.nombre || "",
				frecuencia: incomeForm.frecuencia,
				fechaProximoPago: nextDueDate,
				diaVencimiento: firstDueDay,
				diaSegundoPago: secondDueDay,
				proximoPagoNumero: 1,
				ultimaActualizacion: serverTimestamp(),
			};
			if (editingIncomeId) {
				const existingIncome = recurringIncomes.find((item) => item.id === editingIncomeId);
				const sameSchedule = existingIncome &&
					(existingIncome.frecuencia || "mensual") === incomeForm.frecuencia &&
					Number(existingIncome.diaVencimiento) === firstDueDay &&
					Number(existingIncome.diaSegundoPago || 0) === Number(secondDueDay || 0);
				const updatedIncomeData = sameSchedule
					? {
						...incomeData,
						fechaProximoPago: existingIncome.fechaProximoPago,
						proximoPagoNumero: existingIncome.proximoPagoNumero || 1,
					}
					: incomeData;
				await updateDoc(doc(db, "ingresosRecurrentes", editingIncomeId), updatedIncomeData);
				setRecurringIncomes((current) => current.map((item) =>
					item.id === editingIncomeId ? { ...item, ...updatedIncomeData } : item
				).sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago))));
				setEditingIncomeId("");
				showToast("Ingreso recurrente actualizado", "success");
			} else {
				const createdIncomeData = {
					...incomeData,
					usuarioId: user.uid,
					activa: true,
					fechaCreacion: serverTimestamp(),
				};
				const incomeRef = await addDoc(collection(db, "ingresosRecurrentes"), createdIncomeData);
				setRecurringIncomes((current) => [...current, { id: incomeRef.id, ...createdIncomeData }]
					.sort((a, b) => String(a.fechaProximoPago).localeCompare(String(b.fechaProximoPago))));
				showToast("Ingreso recurrente registrado", "success");
			}
			setIncomeForm(initialIncomeForm());
		} catch (error) {
			console.error("Error guardando ingreso recurrente:", error);
			showToast("No se pudo guardar el ingreso recurrente", "error");
		} finally {
			setLoading(false);
		}
	};

	const editRecurringIncome = (income) => {
		const nextDueDate = income.fechaProximoPago || getLocalDateString();
		const frequency = income.frecuencia === "quincenal" ? "quincenal" : "mensual";
		setActiveView("incomes");
		setEditingIncomeId(income.id);
		setIncomeForm({
			nombre: income.nombre || "",
			valor: formatMoneyInput(String(Number(income.valor || 0))),
			cuentaId: income.cuentaId || "",
			frecuencia: frequency,
			fechaProximoPago: nextDueDate,
			fechaPrimerPago: Number(income.proximoPagoNumero || 1) === 2
				? getDateForDay(nextDueDate, income.diaVencimiento)
				: nextDueDate,
			fechaSegundoPago: getDateForDay(nextDueDate, income.diaSegundoPago || income.diaVencimiento),
		});
	};

	const closeIncomeEditor = () => {
		setEditingIncomeId("");
		setIncomeForm(initialIncomeForm());
	};

	const toggleRecurringIncome = async (income) => {
		setLoading(true);
		try {
			await updateDoc(doc(db, "ingresosRecurrentes", income.id), { activa: !income.activa });
			setRecurringIncomes((current) => current.map((item) => item.id === income.id
				? { ...item, activa: !item.activa }
				: item));
			showToast(income.activa ? "Ingreso recurrente pausado" : "Ingreso recurrente reactivado", "success");
		} catch (error) {
			console.error("Error actualizando ingreso recurrente:", error);
			showToast("No se pudo actualizar el ingreso recurrente", "error");
		} finally {
			setLoading(false);
		}
	};

	const toggleActive = async (obligation) => {
		const user = auth.currentUser;
		if (!user) {
			showToast("Necesitas iniciar sesión", "error");
			return;
		}
		setLoading(true);
		try {
			const obligationRef = doc(db, "obligaciones", obligation.id);
			const active = await runTransaction(db, async (transaction) => {
				const obligationSnapshot = await transaction.get(obligationRef);
				if (!obligationSnapshot.exists() || obligationSnapshot.data().usuarioId !== user.uid) {
					throw new Error("OBLIGATION_UNAVAILABLE");
				}
				const currentObligation = obligationSnapshot.data();
				const nextActive = !currentObligation.activa;
				if (nextActive && currentObligation.deudaId) {
					const debtSnapshot = await transaction.get(doc(db, "deudas", currentObligation.deudaId));
					if (!debtSnapshot.exists() || debtSnapshot.data().usuarioId !== user.uid ||
						Number(debtSnapshot.data().montoRestante ?? debtSnapshot.data().monto ?? 0) <= 0) {
						throw new Error("DEBT_ALREADY_PAID");
					}
				}
				transaction.update(obligationRef, { activa: nextActive });
				return nextActive;
			});
			setObligations((current) => current.map((item) => item.id === obligation.id
				? { ...item, activa: active }
				: item));
			showToast(active ? "Obligación reactivada" : "Obligación pausada", "success");
		} catch (error) {
			console.error("Error actualizando obligación:", error);
			showToast(error.message === "DEBT_ALREADY_PAID"
				? "No puedes reactivar una obligación cuya deuda ya está saldada"
				: "No se pudo actualizar la obligación", error.message === "DEBT_ALREADY_PAID" ? "info" : "error");
		} finally {
			setLoading(false);
		}
	};

	const deleteObligation = async (obligation) => {
		if (!window.confirm(`¿Seguro que deseas eliminar la obligación "${obligation.nombre}"?`)) return;

		setLoading(true);
		try {
			const batch = writeBatch(db);
			batch.delete(doc(db, "obligaciones", obligation.id));
			if (obligation.deudaId) {
				batch.update(doc(db, "deudas", obligation.deudaId), {
					obligacionId: deleteField(),
					ultimaActualizacion: serverTimestamp(),
				});
			}
			await batch.commit();
			setObligations((current) => current.filter((item) => item.id !== obligation.id));
			showToast("Obligación eliminada", "success");
		} catch (error) {
			console.error("Error eliminando obligación:", error);
			showToast("No se pudo eliminar la obligación", "error");
		} finally {
			setLoading(false);
		}
	};

	const deleteRecurringIncome = async (income) => {
		if (!window.confirm(`¿Seguro que deseas eliminar el ingreso recurrente "${income.nombre}"?`)) return;

		setLoading(true);
		try {
			await deleteDoc(doc(db, "ingresosRecurrentes", income.id));
			setRecurringIncomes((current) => current.filter((item) => item.id !== income.id));
			showToast("Ingreso recurrente eliminado", "success");
		} catch (error) {
			console.error("Error eliminando ingreso recurrente:", error);
			showToast("No se pudo eliminar el ingreso recurrente", "error");
		} finally {
			setLoading(false);
		}
	};

	const renderIncomeFields = () => (
		<>
			<label>
				<span>Concepto del ingreso</span>
				<input required value={incomeForm.nombre} onChange={(event) => setIncomeForm((current) => ({ ...current, nombre: event.target.value.toUpperCase() }))} placeholder="Nómina" />
			</label>
			<label>
				<span>Valor esperado</span>
				<input required type="text" inputMode="numeric" pattern="[0-9.]+" value={incomeForm.valor} onChange={(event) => setIncomeForm((current) => ({ ...current, valor: formatMoneyInput(event.target.value) }))} placeholder="2.500.000" />
			</label>
			<label>
				<span>Cuenta donde recibir</span>
				<select required value={incomeForm.cuentaId} onChange={(event) => setIncomeForm((current) => ({ ...current, cuentaId: event.target.value }))}>
					<option value="">Selecciona una cuenta</option>
					{accounts.filter((account) => account.tipoCuenta !== "credito").map((account) => (
						<option key={account.id} value={account.id}>{account.banco} · {account.nombre}</option>
					))}
				</select>
			</label>
			<label>
				<span>Frecuencia</span>
				<select value={incomeForm.frecuencia} onChange={(event) => setIncomeForm((current) => ({ ...current, frecuencia: event.target.value }))}>
					<option value="mensual">Mensual</option>
					<option value="quincenal">Quincenal</option>
				</select>
			</label>
			{incomeForm.frecuencia === "quincenal" ? (
				<>
					<label>
						<span>Fecha del primer ingreso</span>
						<input required type="date" value={incomeForm.fechaPrimerPago} onChange={(event) => setIncomeForm((current) => ({ ...current, fechaPrimerPago: event.target.value }))} />
					</label>
					<label>
						<span>Fecha del segundo ingreso</span>
						<input required type="date" value={incomeForm.fechaSegundoPago} onChange={(event) => setIncomeForm((current) => ({ ...current, fechaSegundoPago: event.target.value }))} />
					</label>
				</>
			) : (
				<label>
					<span>Próximo ingreso</span>
					<input required type="date" value={incomeForm.fechaProximoPago} onChange={(event) => setIncomeForm((current) => ({ ...current, fechaProximoPago: event.target.value }))} />
				</label>
			)}
			<div className="obligaciones-form__actions">
				<button className="obligaciones-submit" type="submit" disabled={loading || accounts.filter((account) => account.tipoCuenta !== "credito").length === 0}>
					{editingIncomeId ? "Guardar cambios" : "Registrar ingreso recurrente"}
				</button>
				{editingIncomeId && (
					<button className="obligaciones-cancel" type="button" onClick={closeIncomeEditor} disabled={loading}>
						Cancelar
					</button>
				)}
			</div>
		</>
	);

	if (!isOpen) return null;

	return (
		<div className="obligaciones-page">
			{loading && <Loading message="Actualizando pagos e ingresos recurrentes..." />}
			<main className="obligaciones-panel">
				<header className="obligaciones-header">
					<div>
						<span className="obligaciones-eyebrow">Pagos recurrentes</span>
						<h1>Pagos e ingresos recurrentes</h1>
						<p>Administra tus obligaciones y los ingresos que recibes cada mes.</p>
					</div>
					<button className="obligaciones-close" type="button" onClick={onClose}>Cerrar</button>
				</header>

				<div className="obligaciones-tabs" role="tablist" aria-label="Tipo de recurrencia">
					<button
						className={activeView === "obligations" ? "obligaciones-tab obligaciones-tab--active" : "obligaciones-tab"}
						type="button"
						role="tab"
						aria-selected={activeView === "obligations"}
						onClick={() => setActiveView("obligations")}
					>
						Obligaciones de pago <span>{obligations.length}</span>
					</button>
					<button
						className={activeView === "incomes" ? "obligaciones-tab obligaciones-tab--active" : "obligaciones-tab"}
						type="button"
						role="tab"
						aria-selected={activeView === "incomes"}
						onClick={() => setActiveView("incomes")}
					>
						Ingresos recurrentes <span>{recurringIncomes.length}</span>
					</button>
				</div>

				{activeView === "obligations" && (
					<>
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
									{accounts.filter((account) => (account.tipoCuenta || "gastos") === "gastos").map((account) => (
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
							<button className="obligaciones-submit" type="submit" disabled={loading || accounts.filter((account) => (account.tipoCuenta || "gastos") === "gastos").length === 0}>
								Registrar obligación
							</button>
							{accounts.filter((account) => (account.tipoCuenta || "gastos") === "gastos").length === 0 && <p className="obligaciones-hint">Primero necesitas una cuenta de gastos para pagar obligaciones.</p>}
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
										<span>
											${Number(obligation.tipo === "pago_tarjeta"
												? obligation.montoPendiente ?? obligation.valor ?? 0
												: obligation.valor || 0).toLocaleString("es-CO")}
											{obligation.deudaId
												? ` por pago · Saldo de deuda: $${Number(obligation.deudaRestante || 0).toLocaleString("es-CO")}`
												: obligation.tipo === "pago_tarjeta"
													? ` pendiente del extracto · Corte ${formatObligationDate(obligation.fechaCorte)}`
													: ""}
											{" · "}{formatObligationSchedule(obligation)} · {obligation.cuentaNombre}
										</span>
										{obligation.fechaUltimoPeriodoPagado && (
											<span>Periodo cubierto: {formatObligationDate(obligation.fechaUltimoPeriodoPagado)}</span>
										)}
										<span>
											{obligation.deudaPagada ? "Deuda saldada" : obligation.activa ? "Próximo vencimiento" : obligation.tipo === "pago_tarjeta" ? "Extracto pagado" : "Pausada"}
											{!obligation.deudaPagada && `: ${formatObligationDate(obligation.fechaProximoPago)}`}
										</span>
									</div>
									{obligation.tipo !== "pago_tarjeta" && (
										<>
											<button type="button" onClick={() => toggleActive(obligation)} disabled={loading || obligation.deudaPagada}>
												{obligation.deudaPagada ? "Saldada" : obligation.activa ? "Pausar" : "Reactivar"}
											</button>
											<button type="button" onClick={() => editObligation(obligation)} disabled={loading}>
												Editar
											</button>
											<button className="obligacion-row__delete" type="button" onClick={() => deleteObligation(obligation)} disabled={loading}>
												Eliminar
											</button>
										</>
									)}
								</article>
							))}
						</section>
					</>
				)}

				{activeView === "incomes" && (
					<>
						<form className="obligaciones-form" onSubmit={handleIncomeSubmit}>
							{renderIncomeFields()}
						</form>
						<section className="obligaciones-list" aria-labelledby="recurring-incomes-title">
							<div className="obligaciones-list__heading">
								<h2 id="recurring-incomes-title">Tus ingresos recurrentes</h2>
								<span>{recurringIncomes.length}</span>
							</div>
							{recurringIncomes.length === 0 ? (
								<p className="obligaciones-empty">Todavía no has registrado ingresos recurrentes.</p>
							) : recurringIncomes.map((income) => (
								<article className={`obligacion-row${income.activa ? "" : " obligacion-row--paused"}`} key={income.id}>
									<div className="obligacion-row__details">
										<strong>{income.nombre}</strong>
										<span>${Number(income.valor || 0).toLocaleString("es-CO")} · {formatObligationSchedule(income)} · {income.cuentaNombre}</span>
										<span>{income.activa ? "Próximo ingreso" : "Pausado"}: {formatObligationDate(income.fechaProximoPago)}</span>
									</div>
									<button type="button" onClick={() => toggleRecurringIncome(income)} disabled={loading}>
										{income.activa ? "Pausar" : "Reactivar"}
									</button>
									<button type="button" onClick={() => editRecurringIncome(income)} disabled={loading}>
										Editar
									</button>
									<button className="obligacion-row__delete" type="button" onClick={() => deleteRecurringIncome(income)} disabled={loading}>
										Eliminar
									</button>
								</article>
							))}
						</section>
					</>
				)}
			</main>
			{editingId && (
				<div className="obligaciones-modal-overlay" onClick={() => !loading && setEditingId("")}>
					<form
						className="obligaciones-edit-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="edit-obligation-title"
						onClick={(event) => event.stopPropagation()}
						onSubmit={handleSubmit}
					>
						<header className="obligaciones-modal__header">
							<div>
								<h2 id="edit-obligation-title">Editar obligación</h2>
								<p>Actualiza los datos sin cambiar su próximo vencimiento.</p>
							</div>
							<button type="button" className="obligaciones-modal__close" aria-label="Cerrar" disabled={loading} onClick={() => setEditingId("")}>×</button>
						</header>
						<label>
							<span>Nombre</span>
							<input required value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value.toUpperCase() }))} />
						</label>
						<label>
							<span>Valor del pago</span>
							<input required type="text" inputMode="numeric" pattern="[0-9.]+" value={form.valor} onChange={(event) => setForm((current) => ({ ...current, valor: formatMoneyInput(event.target.value) }))} />
						</label>
						<label>
							<span>Cuenta para pagar</span>
							<select required value={form.cuentaId} onChange={(event) => setForm((current) => ({ ...current, cuentaId: event.target.value }))}>
								{accounts.filter((account) => (account.tipoCuenta || "gastos") === "gastos").map((account) => (
									<option key={account.id} value={account.id}>{account.banco} · {account.nombre}</option>
								))}
							</select>
						</label>
						<div className="obligaciones-modal__actions">
							<button className="obligaciones-submit" type="submit" disabled={loading}>Guardar cambios</button>
							<button className="obligaciones-cancel" type="button" disabled={loading} onClick={() => setEditingId("")}>Cancelar</button>
						</div>
					</form>
				</div>
			)}
			{editingIncomeId && (
				<div className="obligaciones-modal-overlay" onClick={() => !loading && closeIncomeEditor()}>
					<form
						className="obligaciones-edit-modal obligaciones-edit-modal--income"
						role="dialog"
						aria-modal="true"
						aria-labelledby="edit-income-title"
						onClick={(event) => event.stopPropagation()}
						onSubmit={handleIncomeSubmit}
					>
						<header className="obligaciones-modal__header">
							<div>
								<h2 id="edit-income-title">Editar ingreso recurrente</h2>
								<p>Modifica el monto, la cuenta o la frecuencia.</p>
							</div>
							<button type="button" className="obligaciones-modal__close" aria-label="Cerrar" disabled={loading} onClick={closeIncomeEditor}>×</button>
						</header>
						{renderIncomeFields()}
					</form>
				</div>
			)}
		</div>
	);
};

export default Obligaciones;
