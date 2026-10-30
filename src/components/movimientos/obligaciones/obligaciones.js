import React, { useEffect, useState } from "react";
import { addDoc, collection, deleteField, deleteDoc, doc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { auth, db } from "../../../server/api";
import Loading from "../../../resources/loading/loading";
import { showToast } from "../../../resources/toastcontainer/ToastContainer";
import { getAccountCardImage } from "../../../resources/imagenes/tarjetas/accountCard";
import {
	getCreditMovementStatementAmount,
	getCreditInstallmentSchedule,
	getCreditStatementForPurchase,
} from "../../cuentas/creditAccountUtils";
import {
	formatObligationDate,
	formatObligationSchedule,
	getDebtTotalAmount,
	getLocalDateString,
	getNextCardStatements,
	getObligationAmount,
	getObligationIncomePlan,
	getMonthlyCommitmentSummary,
	getUniqueDebtObligations,
	sortObligationsByAmount,
} from "./obligationUtils";
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

const getCardStatementCycles = (account) => {
	const currentStatement = getCreditStatementForPurchase(account, new Date());
	if (!currentStatement) return [];

	return [-1, 0, 1].map((offset) => {
		const cutoffMonth = new Date(
			currentStatement.cutoffDate.getFullYear(),
			currentStatement.cutoffDate.getMonth() + offset,
			1
		);
		const schedule = getCreditInstallmentSchedule(
			account,
			1,
			1,
			cutoffMonth
		);
		if (!schedule) return null;
		const cycle = schedule[0];
		const cycleName = offset === -1 ? "Anterior" : offset === 0 ? "Vigente" : "Siguiente";
		return {
			...cycle,
			key: getLocalDateString(cycle.cutoffDate),
			name: cycleName,
			label: `${cycleName} · ${formatObligationDate(getLocalDateString(cycle.startDate))} – ${formatObligationDate(getLocalDateString(cycle.cutoffDate))} · vence ${formatObligationDate(getLocalDateString(cycle.paymentDate))}`,
		};
	}).filter(Boolean);
};

const getMovementDate = (movement) => {
	const value = movement.fechaHora || movement.fechaCreacion;
	const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
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
	const [obligationPlanMode, setObligationPlanMode] = useState("incomePlan");
	const [compensateIncomeSurplus, setCompensateIncomeSurplus] = useState(false);
	const [loading, setLoading] = useState(false);
	const [statementGeneratorOpen, setStatementGeneratorOpen] = useState(false);
	const [statementAccountId, setStatementAccountId] = useState("");
	const [statementCycleKey, setStatementCycleKey] = useState("");

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
		setStatementGeneratorOpen(false);
		setStatementAccountId("");
		setStatementCycleKey("");
		fetchData();
	}, [isOpen]);

	const creditAccounts = accounts.filter((account) => account.tipoCuenta === "credito");
	const selectedStatementAccount = creditAccounts.find((account) => account.id === statementAccountId);
	const statementCycles = selectedStatementAccount
		? getCardStatementCycles(selectedStatementAccount)
		: [];
	const selectedStatementCycle = statementCycles.find((cycle) => cycle.key === statementCycleKey);

	const openStatementGenerator = () => {
		const defaultAccount = creditAccounts[0];
		const cycles = defaultAccount ? getCardStatementCycles(defaultAccount) : [];
		setEditingId("");
		setEditingIncomeId("");
		setStatementAccountId(defaultAccount?.id || "");
		setStatementCycleKey(cycles.find((cycle) => cycle.label.startsWith("Vigente"))?.key || "");
		setStatementGeneratorOpen(true);
	};

	const generateCardStatement = async (event) => {
		event.preventDefault();
		const user = auth.currentUser;
		const account = creditAccounts.find((item) => item.id === statementAccountId);
		const cycle = getCardStatementCycles(account || {}).find((item) => item.key === statementCycleKey);
		if (!user || !account || !cycle) {
			showToast("Selecciona una tarjeta y un ciclo válido", "error");
			return;
		}

		setLoading(true);
		try {
			const [userIdMovementsSnapshot, usuarioIdMovementsSnapshot] = await Promise.all([
				getDocs(query(
					collection(db, "movimientos"),
					where("userId", "==", user.uid)
				)),
				getDocs(query(
					collection(db, "movimientos"),
					where("usuarioId", "==", user.uid)
				)),
			]);
			const movementsById = new Map([
				...userIdMovementsSnapshot.docs,
				...usuarioIdMovementsSnapshot.docs,
			].map((movementDoc) => [
				movementDoc.id,
				{ id: movementDoc.id, ...movementDoc.data() },
			]));
			const movements = [...movementsById.values()]
				.filter((movement) =>
					movement.cuentaId === account.id &&
					["credito_compra", "credito_avance"].includes(movement.tipo) &&
					movement.origen !== "obligacion"
				);
			const cycleInstallments = [];
			const total = movements.reduce((sum, movement) => {
				const purchaseDate = getMovementDate(movement);
				if (!purchaseDate) {
					throw new Error("INVALID_CARD_MOVEMENT");
				}
				const movementAmount = getCreditMovementStatementAmount(
					account,
					movement,
					purchaseDate,
					cycle.key
				);
				if (movement.tipo === "credito_compra" && movement.deudaId && movement.obligacionId) {
					const schedule = getCreditInstallmentSchedule(
						account,
						Number(movement.valor),
						Number(movement.cuotas || 1),
						purchaseDate
					);
					if (!schedule) throw new Error("CREDIT_STATEMENT_DATES_UNAVAILABLE");
					schedule
						.filter((installment) =>
							getLocalDateString(installment.cutoffDate) === cycle.key
						)
						.forEach((installment) => cycleInstallments.push({
							deudaId: movement.deudaId,
							obligacionId: movement.obligacionId,
							numero: installment.installment,
							valor: installment.amount,
						}));
				}
				return sum + movementAmount;
			}, 0);

			if (total <= 0) {
				showToast("No hay movimientos de tarjeta para ese ciclo", "info");
				return;
			}

			const cutoffDate = cycle.key;
			const obligationId = `tarjeta-${account.id}-${cutoffDate}`;
			const obligationRef = doc(db, "obligaciones", obligationId);
			const savedObligation = await runTransaction(db, async (transaction) => {
				const snapshot = await transaction.get(obligationRef);
				const installmentObligationSnapshots = await Promise.all(
					cycleInstallments.map((installment) =>
						transaction.get(doc(db, "obligaciones", installment.obligacionId))
					)
				);
				const previous = snapshot.exists() ? snapshot.data() : null;
				if (previous && (
					previous.usuarioId !== user.uid ||
					previous.tarjetaId !== account.id ||
					previous.tipo !== "pago_tarjeta"
				)) {
					throw new Error("CREDIT_OBLIGATION_CONFLICT");
				}
				const installmentLinks = cycleInstallments.map((installment, index) => {
					const installmentObligationSnapshot = installmentObligationSnapshots[index];
					if (!installmentObligationSnapshot.exists()) {
						throw new Error("CREDIT_INSTALLMENT_LINK_UNAVAILABLE");
					}
					const installmentObligation = installmentObligationSnapshot.data();
					if (installmentObligation.usuarioId !== user.uid ||
						installmentObligation.deudaId !== installment.deudaId) {
						throw new Error("CREDIT_INSTALLMENT_LINK_UNAVAILABLE");
					}
					return {
						...installment,
						pagada: Number(installmentObligation.proximoPagoNumero || 1) > installment.numero,
					};
				});
				const recordedPayments = [...movementsById.values()].reduce((sum, movement) =>
					sum + (movement.obligacionAbonos || []).reduce((movementSum, payment) =>
						payment.obligacionId === obligationId
							? movementSum + Number(payment.valor || 0)
							: movementSum, 0
					), 0);
				const previousPaidAmount = previous
					? Math.max(0, Number(previous.valor || 0) -
						Number(previous.montoPendiente ?? previous.valor ?? 0))
					: 0;
				const paidAmount = Math.max(previousPaidAmount, recordedPayments);
				const pendingAmount = Math.max(0, total - paidAmount);
				const data = {
					usuarioId: user.uid,
					tipo: "pago_tarjeta",
					nombre: `PAGO TARJETA ${account.nombre || account.banco || ""}`.trim(),
					tarjetaId: account.id,
					tarjetaNombre: account.nombre || "",
					tarjetaBanco: account.banco || "",
					cuentaNombre: `${account.banco || ""} · ${account.nombre || ""}`.trim(),
					fechaInicioCiclo: getLocalDateString(cycle.startDate),
					fechaCorte: cutoffDate,
					fechaProximoPago: getLocalDateString(cycle.paymentDate),
					diaVencimiento: Number(getLocalDateString(cycle.paymentDate).slice(-2)),
					frecuencia: "mensual",
					valor: total,
					montoPendiente: pendingAmount,
					activa: pendingAmount > 0,
					anulada: pendingAmount <= 0,
					cuotasCompra: installmentLinks,
					...(previous?.fechaCreacion ? {} : { fechaCreacion: serverTimestamp() }),
					ultimaActualizacion: serverTimestamp(),
				};
				transaction.set(obligationRef, data);
				return { ...data, id: obligationId };
			});
			setObligations((current) => [
				...current.filter((item) => item.id !== savedObligation.id),
				savedObligation,
			].sort((first, second) =>
				String(first.fechaProximoPago).localeCompare(String(second.fechaProximoPago))
			));
			setStatementGeneratorOpen(false);
			showToast("Extracto de tarjeta generado desde sus movimientos", "success");
		} catch (error) {
			console.error("Error generando extracto de tarjeta:", error);
			showToast(error.message === "CREDIT_OBLIGATION_CONFLICT"
				? "Ya existe una obligación distinta para ese ciclo"
				: error.message === "CREDIT_INSTALLMENT_LINK_UNAVAILABLE"
					? "No se pudo vincular una compra financiada con su deuda"
				: error.message === "CREDIT_STATEMENT_DATES_UNAVAILABLE"
					? "Configura las fechas de corte y pago de la tarjeta"
					: error.message === "INVALID_CARD_MOVEMENT"
						? "Hay movimientos de tarjeta con datos inválidos"
						: "No se pudo generar el extracto de tarjeta", "error");
		} finally {
			setLoading(false);
		}
	};

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
		if (!name || !Number.isSafeInteger(amount) || amount <= 0 || !firstPaymentDate) {
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
				if (editingId) {
					const existingObligation = obligations.find((item) => item.id === editingId);
					if (!existingObligation) {
						throw new Error("OBLIGATION_UNAVAILABLE");
					}
					const dueDate = form.frecuencia === "quincenal" &&
						Number(existingObligation.proximoPagoNumero || 1) === 2
						? secondPaymentDate
						: firstPaymentDate;
					const dueDay = Number(firstPaymentDate.slice(-2));
					const secondDueDay = form.frecuencia === "quincenal"
						? Number(secondPaymentDate.slice(-2))
						: null;
					const updatedData = {
						nombre: name,
						valor: amount,
						cuentaId: account.id,
						cuentaBanco: account.banco || "",
						cuentaNombre: account.nombre || "",
						frecuencia: form.frecuencia,
						fechaProximoPago: dueDate,
						diaVencimiento: dueDay,
						diaSegundoPago: secondDueDay,
						proximoPagoNumero: existingObligation.frecuencia === form.frecuencia
							? Number(existingObligation.proximoPagoNumero || 1)
							: 1,
						ultimaActualizacion: serverTimestamp(),
					};
					const obligationRef = doc(db, "obligaciones", editingId);
					const debtRef = existingObligation.deudaId
						? doc(db, "deudas", existingObligation.deudaId)
						: null;
					await runTransaction(db, async (transaction) => {
						const debtSnapshot = debtRef ? await transaction.get(debtRef) : null;
						if (debtRef && (!debtSnapshot?.exists() ||
							debtSnapshot.data().usuarioId !== user.uid)) {
							throw new Error("OBLIGATION_DEBT_UNAVAILABLE");
						}
						transaction.update(obligationRef, updatedData);
						if (debtRef) {
							transaction.update(debtRef, {
								proximaFechaPago: dueDate,
								ultimaActualizacion: serverTimestamp(),
							});
						}
					});
					setObligations((current) => current.map((item) =>
						item.id === editingId ? { ...item, ...updatedData } : item
					).sort((first, second) =>
						String(first.fechaProximoPago).localeCompare(String(second.fechaProximoPago))
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
			showToast(error.message === "OBLIGATION_DEBT_UNAVAILABLE"
				? "No se pudo actualizar la fecha de la deuda asociada"
				: "No se pudo guardar la obligación", "error");
		} finally {
			setLoading(false);
		}
	};

	const editObligation = (obligation) => {
		const nextDueDate = obligation.fechaProximoPago || getLocalDateString();
		const frequency = obligation.frecuencia === "quincenal" ? "quincenal" : "mensual";
		const firstDate = frequency === "quincenal"
			? getDateForDay(nextDueDate, obligation.diaVencimiento || nextDueDate.slice(-2))
			: nextDueDate;
		const secondDate = frequency === "quincenal"
			? getDateForDay(nextDueDate, obligation.diaSegundoPago || Number(nextDueDate.slice(-2)) + 15)
			: "";
		setActiveView("obligations");
		setEditingIncomeId("");
		setStatementGeneratorOpen(false);
		setEditingId(obligation.id);
		setForm({
			nombre: obligation.nombre || "",
			valor: formatMoneyInput(String(Number(obligation.valor || 0))),
			cuentaId: obligation.cuentaId || "",
			frecuencia: frequency,
			fechaProximoPago: nextDueDate,
			fechaPrimerPago: firstDate,
			fechaSegundoPago: secondDate,
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
		setEditingId("");
		setStatementGeneratorOpen(false);
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
		const isCardStatement = obligation.tipo === "pago_tarjeta";
		const confirmation = isCardStatement
			? `¿Eliminar el extracto de "${obligation.nombre}"? No se borrarán los movimientos y podrás volver a generarlo desde ellos.`
			: `¿Seguro que deseas eliminar la obligación "${obligation.nombre}"?`;
		if (!window.confirm(confirmation)) return;

		setLoading(true);
		try {
			if (isCardStatement) {
				await deleteDoc(doc(db, "obligaciones", obligation.id));
			} else {
				const batch = writeBatch(db);
				batch.delete(doc(db, "obligaciones", obligation.id));
				if (obligation.deudaId) {
					batch.update(doc(db, "deudas", obligation.deudaId), {
						obligacionId: deleteField(),
						ultimaActualizacion: serverTimestamp(),
					});
				}
				await batch.commit();
			}
			setObligations((current) => current.filter((item) => item.id !== obligation.id));
			showToast(isCardStatement ? "Extracto de tarjeta eliminado" : "Obligación eliminada", "success");
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

	const uniqueObligations = getUniqueDebtObligations(obligations);
	const activeRegularObligations = sortObligationsByAmount(uniqueObligations.filter((obligation) =>
		obligation.tipo !== "pago_tarjeta" && obligation.activa
	));
	const activeCardStatements = sortObligationsByAmount(getNextCardStatements(uniqueObligations));
	const pausedObligations = sortObligationsByAmount(uniqueObligations.filter((obligation) =>
		obligation.tipo !== "pago_tarjeta" && !obligation.activa
	));
	const paidCardStatements = sortObligationsByAmount(uniqueObligations.filter((obligation) =>
		obligation.tipo === "pago_tarjeta" && !obligation.activa
	));
	const incomePlan = getObligationIncomePlan(
		uniqueObligations,
		recurringIncomes,
		getLocalDateString(),
		compensateIncomeSurplus
	);
	const monthlyCommitment = getMonthlyCommitmentSummary(
		[...activeRegularObligations, ...activeCardStatements],
		recurringIncomes
	);

	const renderObligationRows = (items) => items.map((obligation) => (
		(() => {
			const debtTotal = obligation.deudaId ? getDebtTotalAmount(obligation) : 0;
			const debtRemaining = obligation.deudaId
				? Math.max(0, Number(obligation.deudaRestante ?? debtTotal))
				: 0;
			const installmentCount = Math.max(
				1,
				Math.floor(Number(obligation.cuotas || obligation.valoresCuota?.length || 1)) || 1
			);
			const paidInstallments = obligation.deudaPagada
				? installmentCount
				: Math.min(installmentCount, Math.max(0, Number(obligation.proximoPagoNumero || 1) - 1));
			return (
				<article
					className={`obligacion-row${obligation.activa ? "" : " obligacion-row--paused"}`}
					key={obligation.id}
				>
					<div className="obligacion-row__details">
						<strong>{obligation.nombre}</strong>
						<span>
							${getObligationAmount(obligation).toLocaleString("es-CO")}
							{obligation.deudaId
								? ` total · Cuota ${obligation.proximoPagoNumero || 1} de ${obligation.cuotas || obligation.valoresCuota?.length || 1}`
								: obligation.tipo === "pago_tarjeta"
									? ` pendiente del extracto · Corte ${formatObligationDate(obligation.fechaCorte)}`
									: ""}
							{" · "}{formatObligationSchedule(obligation)} · {obligation.cuentaNombre}
						</span>
						{obligation.deudaId && (
							<div className="obligacion-debt-progress">
								<div
									className="obligacion-debt-progress__installments"
									role="progressbar"
									aria-label={`Cuotas pagadas de ${obligation.nombre}`}
									aria-valuemin="0"
									aria-valuemax={installmentCount}
									aria-valuenow={paidInstallments}
								>
									{Array.from({ length: installmentCount }, (_, index) => (
										<span
											key={index}
											className={index < paidInstallments
												? "obligacion-debt-progress__slot obligacion-debt-progress__slot--paid"
												: "obligacion-debt-progress__slot"}
										/>
									))}
								</div>
								<span>
									Cuotas pagadas {paidInstallments} de {installmentCount}
									{" · "}Pagado ${Math.max(0, debtTotal - debtRemaining).toLocaleString("es-CO")} de ${debtTotal.toLocaleString("es-CO")}
									{" · "}Restante ${debtRemaining.toLocaleString("es-CO")}
								</span>
							</div>
						)}
						{obligation.fechaUltimoPeriodoPagado && (
							<span>Periodo cubierto: {formatObligationDate(obligation.fechaUltimoPeriodoPagado)}</span>
						)}
						<span>
							{obligation.deudaPagada
								? "Deuda saldada"
								: obligation.activa
									? "Próximo vencimiento"
									: obligation.tipo === "pago_tarjeta" ? "Extracto pagado" : "Pausada"}
							{!obligation.deudaPagada && `: ${formatObligationDate(obligation.fechaProximoPago)}`}
						</span>
					</div>
					{obligation.tipo !== "pago_tarjeta" && (
						<>
							<button
								type="button"
								onClick={() => toggleActive(obligation)}
								disabled={loading || obligation.deudaPagada}
							>
								{obligation.deudaPagada ? "Saldada" : obligation.activa ? "Pausar" : "Reactivar"}
							</button>
							<button type="button" onClick={() => editObligation(obligation)} disabled={loading}>
								Editar
							</button>
							<button
								className="obligacion-row__delete"
								type="button"
								onClick={() => deleteObligation(obligation)}
								disabled={loading}
							>
								Eliminar
							</button>
						</>
					)}
					{obligation.tipo === "pago_tarjeta" && (
						<button
							className="obligacion-row__delete"
							type="button"
							onClick={() => deleteObligation(obligation)}
							disabled={loading}
						>
							Eliminar extracto
						</button>
					)}
				</article>
			);
		})()
	));

	const renderObligationSection = (title, items, emptyMessage, id, defaultOpen = false) => (
		<details className="obligaciones-group" open={defaultOpen}>
			<summary className="obligaciones-list__heading">
				<h3 id={id}>{title}</h3>
				<span>{items.length}</span>
			</summary>
			<div className="obligaciones-group__content">
				{items.length === 0
					? <p className="obligaciones-empty">{emptyMessage}</p>
					: renderObligationRows(items)}
			</div>
		</details>
	);

	const closeObligationEditor = () => {
		setEditingId("");
		setForm(initialForm());
	};

	const renderObligationFormFields = () => (
		<>
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
			<div className="obligaciones-form__actions">
				<button className="obligaciones-submit" type="submit" disabled={loading || accounts.filter((account) => (account.tipoCuenta || "gastos") === "gastos").length === 0}>
					{editingId ? "Guardar cambios" : "Registrar obligación"}
				</button>
				{editingId && (
					<button className="obligaciones-cancel" type="button" onClick={closeObligationEditor} disabled={loading}>
						Cancelar
					</button>
				)}
			</div>
			{accounts.filter((account) => (account.tipoCuenta || "gastos") === "gastos").length === 0 && (
				<p className="obligaciones-hint">Primero necesitas una cuenta de gastos para pagar obligaciones.</p>
			)}
		</>
	);

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
						{!editingId && (
							<form className="obligaciones-form" onSubmit={handleSubmit}>
								{renderObligationFormFields()}
							</form>
						)}
						<div className="obligaciones-statement-tools">
							<button
								className="obligaciones-submit"
								type="button"
								onClick={openStatementGenerator}
								disabled={loading || creditAccounts.length === 0}
							>
								CREAR EXTRACTO DE TARJETA
							</button>
							{creditAccounts.length === 0 && (
								<p className="obligaciones-hint">No tienes tarjetas de crédito configuradas.</p>
							)}
						</div>
						<section className="obligaciones-list" aria-labelledby="obligaciones-list-title">
							<div className="obligaciones-list__heading obligaciones-list__heading--main">
								<h2 id="obligaciones-list-title">Tus obligaciones</h2>
								<span>{uniqueObligations.length} en total</span>
							</div>
							<section className="obligaciones-income-plan" aria-labelledby="income-plan-title">
								<div className="obligaciones-plan-switch" role="tablist" aria-label="Vista de obligaciones">
									<button
										className={obligationPlanMode === "incomePlan" ? "is-selected" : ""}
										type="button"
										role="tab"
										aria-selected={obligationPlanMode === "incomePlan"}
										onClick={() => setObligationPlanMode("incomePlan")}
									>
										Plan por ingresos
									</button>
									<button
										className={obligationPlanMode === "monthlyCommitment" ? "is-selected" : ""}
										type="button"
										role="tab"
										aria-selected={obligationPlanMode === "monthlyCommitment"}
										onClick={() => setObligationPlanMode("monthlyCommitment")}
									>
										Compromiso mensual
									</button>
								</div>
								{obligationPlanMode === "incomePlan" ? (
									<>
										<label className={`obligaciones-compensate${compensateIncomeSurplus ? " is-enabled" : ""}`}>
											<input
												type="checkbox"
												checked={compensateIncomeSurplus}
												onChange={(event) => setCompensateIncomeSurplus(event.target.checked)}
											/>
											<span className="obligaciones-compensate__copy">
												<strong>Compensar sobrantes</strong>
												<small>Usar solo ingresos de hoy en adelante. El excedente pasa al siguiente pago y lo que sobre queda disponible para ahorrar o usar.</small>
											</span>
											<span className="obligaciones-compensate__switch" aria-hidden="true">
												<span />
											</span>
										</label>
										<div className="obligaciones-list__heading">
											<div>
												<h3 id="income-plan-title">Plan según tus ingresos</h3>
												<p>Proyección del próximo mes y los vencimientos del 1 al 14 del siguiente: el ingreso del 30 cubre del 1 al 14 siguiente y los vencimientos del 30 en adelante; el del 15 cubre del 15 al 29. Si falta el ingreso de una fecha, sus pagos quedan sin asignar. No se mueve dinero.</p>
											</div>
										</div>
										{incomePlan.allocations.length === 0 && incomePlan.unassigned.length === 0 ? (
											<p className="obligaciones-empty">
												Registra ingresos recurrentes y obligaciones activas para ver cómo se distribuyen.
											</p>
										) : (
											<>
												{incomePlan.allocations.map((plan) => (
													<details className="obligaciones-income-plan__group" key={plan.date}>
														<summary>
															<div>
																<strong>Ingreso del {formatObligationDate(plan.date)}</strong>
																<span>{plan.incomeNames.join(" · ")}</span>
															</div>
															<div className="obligaciones-income-plan__totals">
																<span>Previsto ${plan.amount.toLocaleString("es-CO")}</span>
																{plan.carryIn > 0 && (
																	<span>
																		+ Sobrante anterior ${plan.carryIn.toLocaleString("es-CO")}
																	</span>
																)}
																{compensateIncomeSurplus && (
																	<strong>
																		Disponible ${plan.availableAmount.toLocaleString("es-CO")}
																	</strong>
																)}
																{plan.shortfall > 0 ? (
																	<strong className="obligaciones-income-plan__shortfall">
																		Faltan ${plan.shortfall.toLocaleString("es-CO")}
																	</strong>
																) : compensateIncomeSurplus ? (
																	<strong className="obligaciones-income-plan__covered">
																		Disponible para ahorrar o usar: ${plan.remainingIncome.toLocaleString("es-CO")}
																	</strong>
																) : (
																	<strong className="obligaciones-income-plan__covered">
																		Cubierto
																	</strong>
																)}
															</div>
														</summary>
														<ul>
															{plan.obligations.map((obligation) => (
																<li key={obligation.planId}>
																	<span>
																		{obligation.nombre}
																		<small>Vence {formatObligationDate(obligation.fechaProximoPago)}</small>
																	</span>
																	<span>
																		${obligation.plannedAmount.toLocaleString("es-CO")}
																		{obligation.shortfall > 0 && (
																			<small className="obligaciones-income-plan__shortfall">
																				Faltan ${obligation.shortfall.toLocaleString("es-CO")}
																			</small>
																		)}
																	</span>
																</li>
															))}
														</ul>
													</details>
												))}
												{incomePlan.unassigned.length > 0 && (
													<div className="obligaciones-income-plan__unassigned">
														<strong>Sin ingreso programado antes del vencimiento</strong>
														{incomePlan.unassigned.map((obligation) => (
															<span key={obligation.id}>
																{obligation.nombre} · vence {formatObligationDate(obligation.fechaProximoPago)}
															</span>
														))}
													</div>
												)}
											</>
										)}
									</>
								) : (
									<>
										<div className="obligaciones-list__heading">
											<div>
												<h3 id="income-plan-title">Compromiso mensual</h3>
												<p>Valores recurrentes normalizados por mes; cada ingreso u obligación quincenal cuenta dos veces. Es una estimación, no mueve dinero.</p>
											</div>
										</div>
										<div className="obligaciones-monthly-summary">
											<article>
												<span>Ingresos mensuales</span>
												<strong>${monthlyCommitment.monthlyIncome.toLocaleString("es-CO")}</strong>
											</article>
											<article>
												<span>Comprometido en obligaciones</span>
												<strong>${monthlyCommitment.monthlyObligations.toLocaleString("es-CO")}</strong>
											</article>
											<article className={monthlyCommitment.remaining < 0 ? "is-short" : "is-available"}>
												<span>{monthlyCommitment.remaining < 0 ? "Faltante estimado" : "Restante estimado"}</span>
												<strong>${Math.abs(monthlyCommitment.remaining).toLocaleString("es-CO")}</strong>
											</article>
										</div>
										{monthlyCommitment.items.length === 0 ? (
											<p className="obligaciones-empty">No tienes obligaciones activas con monto mensual calculable.</p>
										) : (
											<ul className="obligaciones-monthly-list">
												{monthlyCommitment.items.map((obligation) => (
													<li key={obligation.id}>
														<span>
															{obligation.nombre}
															<small>{obligation.frecuencia === "quincenal" ? "Quincenal · x2 al mes" : "Mensual"}</small>
														</span>
														<strong>${obligation.monthlyAmount.toLocaleString("es-CO")}</strong>
													</li>
												))}
											</ul>
										)}
										{monthlyCommitment.incomes.length > 0 && (
											<p className="obligaciones-monthly-income-detail">
												Ingresos considerados: {monthlyCommitment.incomes.map((income) =>
													`${income.nombre} $${income.monthlyAmount.toLocaleString("es-CO")}`
												).join(" · ")}
											</p>
										)}
									</>
								)}
							</section>
							{obligations.length === 0 ? (
								<p className="obligaciones-empty">Todavía no has registrado obligaciones.</p>
							) : (
								<div className="obligaciones-groups">
									{renderObligationSection(
										"Obligaciones activas",
										activeRegularObligations,
										"No tienes obligaciones recurrentes activas.",
										"active-obligations-title",
										true
									)}
									{renderObligationSection(
										"Extractos de tarjetas pendientes",
										activeCardStatements,
										"No tienes extractos de tarjeta pendientes.",
										"card-statements-title",
										true
									)}
									{renderObligationSection(
										"Pausadas o saldadas",
										pausedObligations,
										"No tienes obligaciones pausadas o saldadas.",
										"paused-obligations-title"
									)}
									{renderObligationSection(
										"Extractos de tarjetas pagados",
										paidCardStatements,
										"No tienes extractos de tarjeta pagados.",
										"paid-card-statements-title"
									)}
								</div>
							)}
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
			{editingId && activeView === "obligations" && (
				<div
					className="obligaciones-modal-overlay"
					onClick={(event) => {
						if (event.target === event.currentTarget && !loading) closeObligationEditor();
					}}
				>
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
								<p>Edita todos los datos, incluida la frecuencia y la próxima fecha de vencimiento.</p>
							</div>
							<button
								type="button"
								className="obligaciones-modal__close"
								aria-label="Cerrar edición"
								disabled={loading}
								onClick={closeObligationEditor}
							>
								×
							</button>
						</header>
						{renderObligationFormFields()}
					</form>
				</div>
			)}
			{statementGeneratorOpen && !editingId && !editingIncomeId && (
				<div
					className="obligaciones-modal-overlay"
					onClick={(event) => {
						if (event.target === event.currentTarget && !loading) setStatementGeneratorOpen(false);
					}}
				>
					<form
						className="obligaciones-edit-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="statement-generator-title"
						onClick={(event) => event.stopPropagation()}
						onSubmit={generateCardStatement}
					>
						<header className="obligaciones-modal__header">
							<div>
								<h2 id="statement-generator-title">Crear extracto de tarjeta</h2>
								<p>Elige una tarjeta y el extracto anterior, vigente o siguiente para reconstruirlo desde los movimientos.</p>
							</div>
							<button
								type="button"
								className="obligaciones-modal__close"
								aria-label="Cerrar"
								disabled={loading}
								onClick={() => setStatementGeneratorOpen(false)}
							>
								×
							</button>
						</header>
						<fieldset className="statement-card-options" aria-label="Selecciona una tarjeta de crédito">
							<legend>Tarjeta de crédito</legend>
							<div className="statement-card-options__grid" role="radiogroup">
								{creditAccounts.map((account) => {
									const selected = statementAccountId === account.id;
									return (
										<button
											key={account.id}
											className={`statement-card-option${selected ? " statement-card-option--selected" : ""}`}
											type="button"
											role="radio"
											aria-checked={selected}
											onClick={() => {
												const cycles = getCardStatementCycles(account);
												setStatementAccountId(account.id);
												setStatementCycleKey(
													cycles.find((cycle) => cycle.name === "Vigente")?.key || ""
												);
											}}
										>
											<img src={getAccountCardImage(account)} alt="" />
											<span className="statement-card-option__details">
												<strong>{account.nombre}</strong>
												<span>{account.banco || "Tarjeta de crédito"}</span>
												<span>
													Corte día {account.fechaCorte || "—"} · Pago día {account.fechaLimitePago || "—"}
												</span>
											</span>
											<span className="statement-card-option__radio" aria-hidden="true" />
										</button>
									);
								})}
							</div>
						</fieldset>
						<fieldset className="statement-cycle-options" aria-label="Selecciona el periodo del extracto">
							<legend>Periodo del extracto</legend>
							<div className="statement-cycle-options__grid" role="radiogroup">
								{statementCycles.map((cycle) => {
									const selected = statementCycleKey === cycle.key;
									return (
										<button
											key={cycle.key}
											className={`statement-cycle-option${selected ? " statement-cycle-option--selected" : ""}`}
											type="button"
											role="radio"
											aria-checked={selected}
											onClick={() => setStatementCycleKey(cycle.key)}
										>
											<span className="statement-cycle-option__radio" aria-hidden="true" />
											<span className="statement-cycle-option__details">
												<strong>{cycle.name}</strong>
												<span>Corte: {formatObligationDate(getLocalDateString(cycle.cutoffDate))}</span>
												<span>Vence: {formatObligationDate(getLocalDateString(cycle.paymentDate))}</span>
												<small>
													{formatObligationDate(getLocalDateString(cycle.startDate))} – {formatObligationDate(getLocalDateString(cycle.cutoffDate))}
												</small>
											</span>
										</button>
									);
								})}
							</div>
						</fieldset>
						{selectedStatementAccount && statementCycles.length === 0 && (
							<p className="obligaciones-hint obligaciones-statement-hint">
								Configura los días de corte y pago de esta tarjeta para reconstruir sus extractos.
							</p>
						)}
						<div className="obligaciones-modal__actions">
							<button
								className="obligaciones-submit"
								type="submit"
								disabled={loading || !selectedStatementAccount || !selectedStatementCycle}
							>
								Generar obligación
							</button>
							<button
								className="obligaciones-cancel"
								type="button"
								disabled={loading}
								onClick={() => setStatementGeneratorOpen(false)}
							>
								Cancelar
							</button>
						</div>
					</form>
				</div>
			)}
			{editingIncomeId && activeView === "incomes" && !editingId && (
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
