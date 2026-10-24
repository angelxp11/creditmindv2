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

export const getHomePendingObligations = (obligations, today = getLocalDateString()) => {
  const currentMonth = today.slice(0, 7);
  const activeObligations = obligations.filter((obligation) =>
    obligation.activa && !obligation.anulada && obligation.fechaProximoPago
  );
  const nextCardStatements = new Map();

  activeObligations
    .filter((obligation) =>
      obligation.tipo === "pago_tarjeta" &&
      String(obligation.fechaProximoPago).slice(0, 7) > currentMonth
    )
    .forEach((obligation) => {
      const cardId = obligation.tarjetaId || obligation.id;
      const currentNextStatement = nextCardStatements.get(cardId);
      if (!currentNextStatement ||
        String(obligation.fechaProximoPago) < String(currentNextStatement.fechaProximoPago)) {
        nextCardStatements.set(cardId, obligation);
      }
    });

  const upcomingCardStatements = new Set(nextCardStatements.values());
  return activeObligations
    .filter((obligation) => {
      if (String(obligation.fechaProximoPago).slice(0, 7) === currentMonth) return true;
      return upcomingCardStatements.has(obligation);
    })
    .sort((first, second) =>
      String(first.fechaProximoPago).localeCompare(String(second.fechaProximoPago))
    );
};

export const getDebtTotalAmount = (obligation) => {
  const installmentTotal = Array.isArray(obligation?.valoresCuota)
    ? obligation.valoresCuota.reduce((total, amount) => total + (Number(amount) || 0), 0)
    : 0;
  if (installmentTotal > 0) return installmentTotal;

  const installmentAmount = Number(obligation?.valor || 0);
  const installments = Number(obligation?.cuotas || 0);
  if (installmentAmount > 0 && installments > 0) return installmentAmount * installments;

  return Number(obligation?.deudaRestante ?? obligation?.valor ?? 0);
};

export const getObligationAmount = (obligation) =>
  obligation?.tipo === "pago_tarjeta"
    ? Number(obligation.montoPendiente ?? obligation.valor ?? 0)
    : obligation?.deudaId
      ? getDebtTotalAmount(obligation)
      : Number(obligation?.valor || 0);

const isMoreRecentDebtProgress = (candidate, current) => {
  if (Boolean(candidate.deudaPagada) !== Boolean(current.deudaPagada)) {
    return Boolean(candidate.deudaPagada);
  }

  const candidateInstallment = Number(candidate.proximoPagoNumero || 1);
  const currentInstallment = Number(current.proximoPagoNumero || 1);
  if (candidateInstallment !== currentInstallment) {
    return candidateInstallment > currentInstallment;
  }

  const candidatePaidDate = String(candidate.fechaUltimoPeriodoPagado || "");
  const currentPaidDate = String(current.fechaUltimoPeriodoPagado || "");
  return candidatePaidDate > currentPaidDate ||
    (candidatePaidDate === currentPaidDate && Boolean(candidate.activa) && !current.activa);
};

export const getUniqueDebtObligations = (obligations) => {
  const debts = new Map();
  const uniqueObligations = [];

  obligations.forEach((obligation) => {
    if (!obligation.deudaId) {
      uniqueObligations.push(obligation);
      return;
    }

    const current = debts.get(obligation.deudaId);
    if (!current || isMoreRecentDebtProgress(obligation, current)) {
      debts.set(obligation.deudaId, obligation);
    }
  });

  return [...uniqueObligations, ...debts.values()];
};

export const getNextCardStatements = (obligations) => {
  const nextStatements = new Map();

  obligations
    .filter((obligation) =>
      obligation.tipo === "pago_tarjeta" &&
      obligation.activa &&
      !obligation.anulada
    )
    .forEach((obligation) => {
      const cardId = obligation.tarjetaId || obligation.id;
      const current = nextStatements.get(cardId);
      if (!current ||
        String(obligation.fechaProximoPago) < String(current.fechaProximoPago)) {
        nextStatements.set(cardId, obligation);
      }
    });

  return [...nextStatements.values()];
};

export const sortObligationsByAmount = (obligations) =>
  [...obligations].sort((first, second) =>
    getObligationAmount(second) - getObligationAmount(first)
  );

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