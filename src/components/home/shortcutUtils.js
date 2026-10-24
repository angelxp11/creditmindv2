import { normalizePlaceName, resolvePlaceName } from "../lugares/lugarUtils";

const parseShortcutAmount = (value) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;

  const normalizedAmount = value.trim().replace(/^\$\s*/, "").replace(/\s/g, "");
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(normalizedAmount)) {
    return Number.NaN;
  }

  return Number(normalizedAmount.replace(/\./g, "").replace(",", "."));
};

const parseShortcutDate = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;

  const match = value.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})$/
  );
  if (match) {
    const [day, month, year, hour, minute] = match.slice(1).map(Number);
    const localDate = new Date(year, month - 1, day, hour, minute);
    if (
      localDate.getFullYear() !== year ||
      localDate.getMonth() !== month - 1 ||
      localDate.getDate() !== day ||
      localDate.getHours() !== hour ||
      localDate.getMinutes() !== minute
    ) {
      return null;
    }
    return localDate.toISOString();
  }

  return Number.isNaN(new Date(value).getTime()) ? null : value;
};

export const parseShortcutMovement = (clipboardText) => {
  let payload;
  try {
    const normalizedClipboardText = clipboardText.replace(
      /("importe"\s*:\s*)\$\s*([\d.]+(?:,\d+)?)/g,
      '$1"$2"'
    );
    payload = JSON.parse(normalizedClipboardText);
  } catch (error) {
    throw new Error("El portapapeles no contiene un JSON válido");
  }

  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error("El atajo debe contener un único movimiento en una lista");
  }

  const [movement] = payload;
  const amount = parseShortcutAmount(movement?.importe);
  const fechaHora = parseShortcutDate(movement?.fecha_hora);
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

  if (!fechaHora) {
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
    fechaHora,
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

const getMovementNames = (movement) =>
  [movement.establecimiento, movement.nombreLegal, movement.nombreEstablecimiento]
    .map(normalizePlaceName)
    .filter(Boolean);

const namesMatch = (first, second) =>
  first === second ||
  (Math.min(first.length, second.length) >= 5 &&
    (first.includes(second) || second.includes(first)));

const isSimilarAmount = (savedValue, searchValue) => {
  const parseAmount = (value) => Math.abs(Number(
    typeof value === "string" ? value.replace(/\./g, "").replace(",", ".") : value
  ));
  const saved = parseAmount(savedValue);
  const search = parseAmount(searchValue);
  if (!Number.isFinite(saved) || !Number.isFinite(search) || saved <= 0 || search <= 0) {
    return false;
  }
  return Math.abs(saved - search) / Math.max(saved, search) <= 0.2;
};

const getPlaceNames = (legalName, savedPlaces, location) => {
  const byLocation = resolvePlaceName(legalName, savedPlaces, location);
  if (byLocation) return [byLocation];

  const source = normalizePlaceName(legalName);
  return savedPlaces
    .filter((place) =>
      !place.sinTarjeta &&
      [place.nombreLegal, place.establecimientoNormalizado]
        .some((name) => normalizePlaceName(name) === source)
    )
    .map((place) => place.nombreLugar);
};

export const getShortcutTagSuggestions = (
  movementHistory,
  establishment,
  amount,
  aliases = [],
  savedPlaces = [],
  location = null
) => {
  const searchNames = [...new Set(
    [establishment, ...aliases, ...getPlaceNames(establishment, savedPlaces, location)]
      .map(normalizePlaceName)
      .filter(Boolean)
  )];
  if (!searchNames.length) return [];

  const historyWithRecognizedPlaces = movementHistory.map((movement) => {
    const recognizedName = resolvePlaceName(
      movement.nombreLegal || movement.establecimiento,
      savedPlaces,
      movement.ubicacion
    );
    return recognizedName
      ? { ...movement, nombreEstablecimiento: recognizedName }
      : movement;
  });
  const sameEstablishment = historyWithRecognizedPlaces.filter((movement) =>
    getMovementNames(movement).some((name) =>
      searchNames.some((searchName) => namesMatch(name, searchName))
    )
  );
  const bySimilarAmount = sameEstablishment.filter((movement) =>
    isSimilarAmount(movement.valor, amount)
  );
  const similarMovements = bySimilarAmount.length ? bySimilarAmount : sameEstablishment;
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

export const getIdentifiedMovementHistory = (movementHistory, savedPlaces = []) =>
  movementHistory.map((movement) => {
    const name = movement.nombreEstablecimiento ||
      resolvePlaceName(
        movement.nombreLegal || movement.establecimiento,
        savedPlaces,
        movement.ubicacion
      ) ||
      movement.establecimiento;
    return {
      ...movement,
      establecimiento: name,
      nombreLegal: "",
      nombreEstablecimiento: name,
    };
  });

export const getIdentifiedMovementNames = (movementHistory, query, savedPlaces = []) => {
  const normalizedQuery = normalizePlaceName(query);
  if (normalizedQuery.length < 3) return [];

  const matches = new Map();
  getIdentifiedMovementHistory(movementHistory, savedPlaces).forEach((movement) => {
    const name = String(movement.nombreEstablecimiento || "").trim();
    const normalizedName = normalizePlaceName(name);
    if (!normalizedName.startsWith(normalizedQuery)) return;
    const match = matches.get(normalizedName) || { name, count: 0 };
    match.count += 1;
    matches.set(normalizedName, match);
  });
  savedPlaces.forEach((place) => {
    if (place.sinTarjeta) return;
    const name = String(place.nombreLugar || "").trim();
    const normalizedName = normalizePlaceName(name);
    if (!normalizedName.startsWith(normalizedQuery)) return;
    if (!matches.has(normalizedName)) {
      matches.set(normalizedName, { name, count: 0 });
    }
  });

  return [...matches.values()]
    .sort((first, second) =>
      second.count - first.count || first.name.localeCompare(second.name, "es")
    )
    .map(({ name }) => name);
};

export const findIdentifiedMovementName = (movementHistory, query, savedPlaces = []) => {
  const names = getIdentifiedMovementNames(movementHistory, query, savedPlaces);
  return names.length === 1 ? names[0] : "";
};

export const getDefaultCreditInstallments = (movementHistory, identifiedName) => {
  const normalizedName = normalizePlaceName(identifiedName);
  if (!normalizedName) return 1;

  const previousInstallmentCounts = movementHistory
    .filter((movement) =>
      normalizePlaceName(movement.nombreEstablecimiento || movement.establecimiento) === normalizedName
    )
    .map((movement) => Number(movement.cuotas))
    .filter((installments) => Number.isSafeInteger(installments) && installments > 1)
    .sort((first, second) => second - first);

  return previousInstallmentCounts[0] || 1;
};

export const getIdentifiedMovementTagSuggestions = (
  movementHistory,
  identifiedName,
  amount
) => {
  return getShortcutTagSuggestions(
    getIdentifiedMovementHistory(movementHistory),
    identifiedName,
    amount
  );
};

export const getShortcutTags = (selectedTags = [], uncommittedTag = "") => {
  return [...new Set([
    ...(Array.isArray(selectedTags) ? selectedTags : []),
    uncommittedTag,
  ]
    .map((tag) => String(tag || "").trim().replace(/,$/, "").toUpperCase())
    .filter(Boolean))];
};

export const getShortcutAvailableTags = (movementHistory, additionalTags = []) => {
  const tags = new Set();

  movementHistory.forEach((movement) => {
    (Array.isArray(movement.tags) ? movement.tags : []).forEach((value) => {
      const tag = String(value || "").trim().replace(/,$/, "").toUpperCase();
      if (tag) tags.add(tag);
    });
  });

  additionalTags.forEach((value) => {
    const tag = String(value || "").trim().replace(/,$/, "").toUpperCase();
    if (tag) tags.add(tag);
  });

  return [...tags].sort((first, second) => first.localeCompare(second, "es"));
};
