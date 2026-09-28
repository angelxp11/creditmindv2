const parseDateOnly = (value) => {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

export const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDateForDay = (year, month, requestedDay) => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return getLocalDateString(new Date(year, month, Math.min(Number(requestedDay), lastDay)));
};

export const getNextDueDate = (frequency, currentDate, dueDay, secondDueDay, paymentNumber = 1) => {
  const date = parseDateOnly(currentDate);
  if (!date) return getLocalDateString();

  if (frequency === "quincenal") {
    if (!secondDueDay) {
      date.setDate(date.getDate() + 15);
      return getLocalDateString(date);
    }

    if (Number(paymentNumber) === 1) {
      return getDateForDay(date.getFullYear(), date.getMonth(), secondDueDay);
    }

    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return getDateForDay(nextMonth.getFullYear(), nextMonth.getMonth(), dueDay);
  }

  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return getDateForDay(nextMonth.getFullYear(), nextMonth.getMonth(), Number(dueDay) || date.getDate());
};

export const isObligationDue = (dueDate, today = getLocalDateString()) =>
  Boolean(dueDate) && String(dueDate).slice(0, 10) <= today;

export const formatObligationDate = (value) => {
  const date = parseDateOnly(value);
  return date ? date.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" }) : "Sin fecha";
};

export const formatObligationSchedule = (obligation) => {
  const firstDay = Number(obligation?.diaVencimiento || obligation?.diaPrimerPago);
  if (obligation?.frecuencia === "quincenal" && obligation?.diaSegundoPago) {
    return `Quincenal: días ${firstDay} y ${obligation.diaSegundoPago} de cada mes`;
  }
  return obligation?.frecuencia === "quincenal"
    ? "Quincenal: cada 15 días"
    : `Mensual: día ${firstDay} de cada mes`;
};