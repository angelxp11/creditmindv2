export const PLACE_LOCATION_TOLERANCE_METERS = 50;

export const normalizePlaceName = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toUpperCase();

export const parsePlaceCoordinates = (value) => {
  const match = String(value || "").trim().match(
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
  );
  if (!match) return null;

  const latitud = Number(match[1]);
  const longitud = Number(match[2]);
  if (
    !Number.isFinite(latitud) || latitud < -90 || latitud > 90 ||
    !Number.isFinite(longitud) || longitud < -180 || longitud > 180
  ) {
    return null;
  }
  return { latitud, longitud };
};

export const getPlaceDistanceMeters = (first, second) => {
  if (!first || !second) return Number.POSITIVE_INFINITY;
  const coordinates = [
    first.latitud,
    first.longitud,
    second.latitud,
    second.longitud,
  ];
  if (coordinates.some((coordinate) =>
    coordinate === null || coordinate === undefined || coordinate === ""
  )) {
    return Number.POSITIVE_INFINITY;
  }
  const latitude1 = Number(first.latitud);
  const longitude1 = Number(first.longitud);
  const latitude2 = Number(second.latitud);
  const longitude2 = Number(second.longitud);
  if (![latitude1, longitude1, latitude2, longitude2].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }

  const radians = (degrees) => degrees * (Math.PI / 180);
  const latitudeDifference = radians(latitude2 - latitude1);
  const longitudeDifference = radians(longitude2 - longitude1);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(radians(latitude1)) *
      Math.cos(radians(latitude2)) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const getValidLocation = (movement) => {
  const latitudeValue = movement.ubicacion?.latitud;
  const longitudeValue = movement.ubicacion?.longitud;
  const latitud = Number(latitudeValue);
  const longitud = Number(longitudeValue);
  if (
    latitudeValue === null || latitudeValue === undefined || latitudeValue === "" ||
    longitudeValue === null || longitudeValue === undefined || longitudeValue === "" ||
    !Number.isFinite(latitud) || latitud < -90 || latitud > 90 ||
    !Number.isFinite(longitud) || longitud < -180 || longitud > 180
  ) {
    return null;
  }
  return { latitud, longitud };
};

const getSavedSourceName = (place) => normalizePlaceName(
  place.establecimientoNormalizado || place.nombreLegal
);

const savedPlaceMatchesSource = (place, sourceName) => (
  getSavedSourceName(place) === sourceName ||
  normalizePlaceName(place.nombreLegal) === sourceName ||
  (Array.isArray(place.establecimientosNormalizados) &&
    place.establecimientosNormalizados.some((name) => normalizePlaceName(name) === sourceName))
);

const findSavedPlace = (sourceName, location, savedPlaces) => {
  const candidates = savedPlaces.filter((place) => savedPlaceMatchesSource(place, sourceName));
  if (!location) {
    return candidates.length === 1 ? candidates[0] : null;
  }

  return candidates
    .map((place) => ({
      place,
      distance: getPlaceDistanceMeters(location, place.ubicacion),
    }))
    .filter(({ distance }) => distance <= PLACE_LOCATION_TOLERANCE_METERS)
    .sort((first, second) => first.distance - second.distance)[0]?.place || null;
};

export const extractPlacesFromMovements = (movements, savedPlaces = []) => {
  const places = new Map();
  const eligibleMovements = movements
    .filter((movement) => {
      const type = String(movement.tipo || "").toLowerCase();
      return !["ingreso", "transferencia", "transfer", "pago_deuda", "pago-deuda"].includes(type) &&
        Boolean(String(movement.nombreLegal || movement.establecimiento || "").trim());
    })
    .map((movement) => {
      const legalName = String(movement.nombreLegal || movement.establecimiento).trim();
      const sourceName = normalizePlaceName(legalName);
      const location = getValidLocation(movement);
      const dateValue = movement.fechaHora?.toDate
        ? movement.fechaHora.toDate()
        : new Date(movement.fechaHora || 0);
      return {
        movement,
        legalName,
        sourceName,
        location,
        timestamp: Number.isNaN(dateValue.getTime()) ? 0 : dateValue.getTime(),
      };
    })
    .sort((first, second) =>
      first.sourceName.localeCompare(second.sourceName) ||
      first.timestamp - second.timestamp ||
      (first.location?.latitud || 0) - (second.location?.latitud || 0) ||
      (first.location?.longitud || 0) - (second.location?.longitud || 0)
    );

  eligibleMovements.forEach(({ movement, legalName, sourceName, location, timestamp }) => {
    const merchantClusters = places.get(sourceName) || [];
    let cluster = location
      ? merchantClusters
        .filter((candidate) => candidate.anchor)
        .map((candidate) => ({
          candidate,
          distance: getPlaceDistanceMeters(location, candidate.anchor),
        }))
        .filter(({ distance }) => distance <= PLACE_LOCATION_TOLERANCE_METERS)
        .sort((first, second) => first.distance - second.distance)[0]?.candidate
      : merchantClusters.find((candidate) => !candidate.anchor);

    if (!cluster) {
      const locationKey = location
        ? `${location.latitud.toFixed(5)},${location.longitud.toFixed(5)}`
        : "sin-ubicacion";
      const id = `${sourceName}::${locationKey}`;
      const savedPlace = findSavedPlace(sourceName, location, savedPlaces);
      cluster = {
        id,
        sourceName,
        sourceNames: [sourceName],
        sourceIds: [id],
        nombreLegal: savedPlace?.sinTarjeta ? "" : savedPlace?.nombreLegal || legalName,
        nombreLugar: savedPlace?.nombreLugar ||
          String(movement.nombreEstablecimiento || legalName).trim(),
        tieneRelacion: Boolean(savedPlace && (
          savedPlace.sinTarjeta || String(savedPlace.nombreLegal || "").trim()
        )),
        sinTarjeta: Boolean(savedPlace?.sinTarjeta),
        movimientos: 0,
        ubicacion: savedPlace?.ubicacion || location,
        ubicacionConfigurada: Boolean(savedPlace?.ubicacion),
        anchor: location,
        ultimaFecha: 0,
      };
      merchantClusters.push(cluster);
      places.set(sourceName, merchantClusters);
    }

    cluster.movimientos += 1;
    if (!cluster.ubicacionConfigurada && location && timestamp >= cluster.ultimaFecha) {
      cluster.ubicacion = location;
      cluster.ultimaFecha = timestamp;
    }
  });

  places.forEach((merchantClusters, sourceName) => {
    if (merchantClusters.length !== 1 || merchantClusters[0].tieneRelacion) return;
    const legacyPlace = findSavedPlace(sourceName, null, savedPlaces);
    if (!legacyPlace || legacyPlace.ubicacion) return;
    Object.assign(merchantClusters[0], {
      nombreLegal: legacyPlace.sinTarjeta ? "" : merchantClusters[0].nombreLegal,
      nombreLugar: legacyPlace.nombreLugar || merchantClusters[0].nombreLugar,
      tieneRelacion: true,
      sinTarjeta: Boolean(legacyPlace.sinTarjeta),
    });
  });

  const extractedPlaces = [...places.values()]
    .flat()
    .map(({ anchor, ultimaFecha, ubicacionConfigurada, ...place }) => place)
    .sort((first, second) =>
      first.nombreLugar.localeCompare(second.nombreLugar, "es") ||
      first.nombreLegal.localeCompare(second.nombreLegal, "es")
    );

  const uniquePlaces = [];
  extractedPlaces.forEach((place) => {
    const placeLegalNames = new Set(place.sourceNames.map(normalizePlaceName));
    const normalizedPlaceName = normalizePlaceName(place.nombreLugar);
    const matchingIndexes = uniquePlaces.reduce((indexes, candidate, index) => {
      const sharesLegalName = candidate.sourceNames.some((name) =>
        placeLegalNames.has(normalizePlaceName(name))
      );
      const sharesIdentifiedName =
        normalizePlaceName(candidate.nombreLugar) === normalizedPlaceName;
      const sharesLocation = candidate.ubicacion && place.ubicacion &&
        getPlaceDistanceMeters(candidate.ubicacion, place.ubicacion) <=
          PLACE_LOCATION_TOLERANCE_METERS;
      if (sharesLegalName || sharesIdentifiedName || sharesLocation) {
        indexes.push(index);
      }
      return indexes;
    }, []);

    if (!matchingIndexes.length) {
      uniquePlaces.push({ ...place });
      return;
    }

    const merged = matchingIndexes
      .map((index) => uniquePlaces[index])
      .reduce((result, candidate) => ({
        ...result,
        ...candidate,
        movimientos: result.movimientos + candidate.movimientos,
        sourceNames: [...new Set([...result.sourceNames, ...candidate.sourceNames])],
        sourceIds: [...new Set([...result.sourceIds, ...candidate.sourceIds])],
        tieneRelacion: result.tieneRelacion || candidate.tieneRelacion,
        sinTarjeta: result.sinTarjeta && candidate.sinTarjeta,
        nombreLegal: result.nombreLegal || candidate.nombreLegal,
        ubicacion: result.ubicacion || candidate.ubicacion,
      }), {
        ...place,
        sourceNames: [...place.sourceNames],
        sourceIds: [...place.sourceIds],
      });

    matchingIndexes
      .sort((first, second) => second - first)
      .forEach((index) => uniquePlaces.splice(index, 1));
    uniquePlaces.push(merged);
  });

  return uniquePlaces;
};

export const resolvePlaceName = (legalName, places, location) => {
  const sourceName = normalizePlaceName(legalName);
  const candidates = places.filter((place) => (
    !place.sinTarjeta &&
    (
      normalizePlaceName(place.nombreLegal) === sourceName ||
      normalizePlaceName(place.establecimientoNormalizado) === sourceName ||
      (Array.isArray(place.establecimientosNormalizados) &&
        place.establecimientosNormalizados.some((name) =>
          normalizePlaceName(name) === sourceName
        ))
    )
  ));
  if (!location) {
    return candidates.length === 1 ? candidates[0].nombreLugar?.trim() || "" : "";
  }

  const nearest = candidates
    .map((place) => ({
      place,
      distance: getPlaceDistanceMeters(location, place.ubicacion),
    }))
    .filter(({ distance }) => distance <= PLACE_LOCATION_TOLERANCE_METERS)
    .sort((first, second) => first.distance - second.distance);
  if (!nearest.length) return "";
  if (
    nearest.length > 1 &&
    nearest[1].distance - nearest[0].distance < 1
  ) {
    return "";
  }
  return nearest[0].place.nombreLugar?.trim() || "";
};
