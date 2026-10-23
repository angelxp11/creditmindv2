import { getSimilarMovements } from "../movimientos/tagSuggestionUtils";

export const parseShortcutMovement = (clipboardText) => {
  let payload;
  try {
    payload = JSON.parse(clipboardText);
  } catch (error) {
    throw new Error("El portapapeles no contiene un JSON válido");
  }

  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error("El atajo debe contener un único movimiento en una lista");
  }

  const [movement] = payload;
  const amount = Number(movement?.importe);
  const date = new Date(movement?.fecha_hora);
  const latitudeValue = movement?.ubicacion?.latitud;
  const longitudeValue = movement?.ubicacion?.longitud;
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);

  if (!String(movement?.comercio || "").trim()) {
    throw new Error("El movimiento del atajo no incluye el comercio");
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("El importe del atajo debe ser un número entero mayor que cero");
  }

  if (!String(movement?.tarjeta || "").trim()) {
    throw new Error("El movimiento del atajo no incluye la tarjeta o pase");
  }

  if (!movement?.fecha_hora || Number.isNaN(date.getTime())) {
    throw new Error("La fecha y hora del atajo no son válidas");
  }

  if (
    !Number.isFinite(latitude) ||
    latitudeValue === null ||
    latitudeValue === undefined ||
    String(latitudeValue).trim() === "" ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitudeValue === null ||
    longitudeValue === undefined ||
    String(longitudeValue).trim() === "" ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("La ubicación del atajo no contiene coordenadas válidas");
  }

  return {
    establecimiento: String(movement.comercio).trim().toUpperCase(),
    valor: amount,
    tarjeta: String(movement.tarjeta).trim(),
    fechaHora: movement.fecha_hora,
    ubicacion: { latitud: latitude, longitud: longitude },
  };
};

const normalizeAccountName = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toUpperCase();

export const findWalletAccount = (accounts, walletName) => {
  const requestedName = normalizeAccountName(walletName);
  if (!requestedName) return null;

  const matches = accounts.filter((account) => {
    if (!["gastos", "credito"].includes(account.tipoCuenta || "gastos")) return false;
    return [
      account.namewallet,
      account.nombre,
      account.banco,
      `${account.banco || ""} ${account.nombre || ""}`,
      `${account.banco || ""} · ${account.nombre || ""}`,
    ].some((name) => normalizeAccountName(name) === requestedName);
  });

  return matches.length === 1 ? matches[0] : null;
};

export const getShortcutTagSuggestions = (movementHistory, establishment, amount) => {
  const similarMovements = getSimilarMovements(movementHistory, establishment, amount);
  const tagFrequency = new Map();

  similarMovements.forEach((movement) => {
    (Array.isArray(movement.tags) ? movement.tags : []).forEach((value) => {
      const tag = String(value || "").trim().replace(/,$/, "").toUpperCase();
      if (tag) tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
    });
  });

  return [...tagFrequency.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0], "es"))
    .map(([tag]) => tag);
};
