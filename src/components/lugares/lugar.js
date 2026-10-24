import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { ChevronDown, MapPin, Search, Store } from "lucide-react";
import { auth, db } from "../../server/api";
import Loading from "../../resources/loading/loading";
import { showToast } from "../../resources/toastcontainer/ToastContainer";
import {
  extractPlacesFromMovements,
  normalizePlaceName,
  parsePlaceCoordinates,
} from "./lugarUtils";
import "./lugar.css";

const Lugar = ({ isOpen }) => {
  const [places, setPlaces] = useState([]);
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [expandedSections, setExpandedSections] = useState({});

  useEffect(() => {
    if (!isOpen) return undefined;

    let active = true;
    const loadPlaces = async () => {
      const user = auth.currentUser;
      if (!user) {
        showToast("Necesitas iniciar sesión para consultar tus lugares", "error");
        return;
      }

      setLoading(true);
      try {
        const [userIdMovements, usuarioIdMovements, userSnapshot] = await Promise.all([
          getDocs(query(collection(db, "movimientos"), where("userId", "==", user.uid))),
          getDocs(query(collection(db, "movimientos"), where("usuarioId", "==", user.uid))),
          getDoc(doc(db, "usuarios", user.uid)),
        ]);
        if (!active) return;

        const movementsById = new Map();
        [...userIdMovements.docs, ...usuarioIdMovements.docs].forEach((movementDoc) => {
          movementsById.set(movementDoc.id, movementDoc.data());
        });
        const saved = Array.isArray(userSnapshot.data()?.lugares)
          ? userSnapshot.data().lugares
          : [];
        setSavedPlaces(saved);
        setPlaces(extractPlacesFromMovements([...movementsById.values()], saved));
      } catch (error) {
        console.error("Error cargando lugares:", error);
        showToast("No se pudieron cargar tus lugares", "error");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadPlaces();
    return () => {
      active = false;
    };
  }, [isOpen]);

  const filteredPlaces = useMemo(() => {
    const normalizedSearch = normalizePlaceName(search);
    if (!normalizedSearch) return places;
    return places.filter((place) =>
      normalizePlaceName(`${place.nombreLugar} ${place.nombreLegal}`).includes(normalizedSearch)
    );
  }, [places, search]);
  const unassignedPlaces = filteredPlaces.filter((place) => !place.tieneRelacion);
  const legalNamePlaces = filteredPlaces.filter((place) =>
    place.tieneRelacion && !place.sinTarjeta
  );
  const noCardPlaces = filteredPlaces.filter((place) =>
    place.tieneRelacion && place.sinTarjeta
  );

  const toggleSection = (section) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const updatePlace = (id, field, value) => {
    setPlaces((current) => current.map((place) =>
      place.id === id ? { ...place, [field]: value } : place
    ));
  };

  const updateCoordinates = (id, value) => {
    const location = parsePlaceCoordinates(value);
    setPlaces((current) => current.map((place) => (
      place.id === id
        ? {
          ...place,
          coordenadasInput: value,
          ...(location ? { ubicacion: location } : {}),
        }
        : place
    )));
  };

  const savePlace = async (place) => {
    const user = auth.currentUser;
    const nombreLugar = String(place.nombreLugar || "").trim();
    const nombreLegal = String(place.nombreLegal || "").trim();
    if (!user) {
      showToast("Necesitas iniciar sesión para guardar un lugar", "error");
      return;
    }
    if (!nombreLugar && !place.sinTarjeta) {
      showToast(
        place.sinTarjeta
          ? "Completa el nombre del lugar"
          : "Completa el nombre del lugar",
        "error"
      );
      return;
    }
    const coordinateInput = String(
      place.coordenadasInput ?? (place.ubicacion
        ? `${place.ubicacion.latitud}, ${place.ubicacion.longitud}`
        : "")
    ).trim();
    const location = coordinateInput ? parsePlaceCoordinates(coordinateInput) : null;
    if (coordinateInput && !location) {
      showToast("Escribe coordenadas válidas como: 7.100471656254416, -73.10723809468608", "error");
      return;
    }
    if (!place.sinTarjeta && !nombreLegal && !location) {
      showToast("Agrega una ubicación o el nombre legal para guardar el lugar", "error");
      return;
    }

    setSavingId(place.id);
    try {
      const placeData = {
        id: place.id,
        establecimientoNormalizado: place.sourceName,
        establecimientosNormalizados: place.sourceNames || [place.sourceName],
        nombreLugar: nombreLugar || String(place.nombreLegal || place.sourceName || "").trim(),
        nombreLegal: place.sinTarjeta ? "" : nombreLegal,
        nombreLegalNormalizado: place.sinTarjeta ? "" : normalizePlaceName(nombreLegal),
        sinTarjeta: Boolean(place.sinTarjeta),
        ...(location ? { ubicacion: location } : {}),
      };
      const nextPlaces = [
        ...savedPlaces.filter((saved) => !(place.sourceIds || [place.id]).includes(saved.id)),
        placeData,
      ];
      await setDoc(doc(db, "usuarios", user.uid), { lugares: nextPlaces }, { merge: true });
      setSavedPlaces(nextPlaces);
      setPlaces((current) => current.map((item) =>
        item.id === place.id
          ? {
            ...item,
            ...placeData,
            tieneRelacion: Boolean(place.sinTarjeta || nombreLegal),
          }
          : item
      ));
      showToast(
        nombreLegal || place.sinTarjeta
          ? `Lugar "${placeData.nombreLugar}" guardado`
          : `Ubicación guardada para "${placeData.nombreLugar}"`,
        "success"
      );
    } catch (error) {
      console.error("Error guardando lugar:", error);
      showToast("No se pudo guardar el lugar", "error");
    } finally {
      setSavingId("");
    }
  };

  const setNoCard = async (place, sinTarjeta) => {
    const user = auth.currentUser;
    if (!user) {
      showToast("Necesitas iniciar sesión para guardar un lugar", "error");
      return;
    }
    if (sinTarjeta && !String(place.nombreLugar || "").trim()) {
      showToast("Completa el nombre del lugar antes de marcarlo sin tarjeta", "error");
      return;
    }

    if (!sinTarjeta && !String(place.nombreLegal || "").trim()) {
      const nextPlaces = savedPlaces.filter((saved) =>
        saved.id !== place.id
      );
      try {
        await setDoc(doc(db, "usuarios", user.uid), { lugares: nextPlaces }, { merge: true });
        setSavedPlaces(nextPlaces);
        setPlaces((current) => current.map((item) =>
          item.id === place.id
            ? { ...item, sinTarjeta: false, tieneRelacion: false }
            : item
        ));
      } catch (error) {
        console.error("Error actualizando la configuración del lugar:", error);
        showToast("No se pudo actualizar el lugar", "error");
      }
      return;
    }

    setSavingId(place.id);
    try {
      const placeData = {
        id: place.id,
        establecimientoNormalizado: place.sourceName,
        establecimientosNormalizados: place.sourceNames || [place.sourceName],
        nombreLugar: String(place.nombreLugar || "").trim(),
        nombreLegal: sinTarjeta ? "" : String(place.nombreLegal || "").trim(),
        nombreLegalNormalizado: sinTarjeta
          ? ""
          : normalizePlaceName(place.nombreLegal),
        ...(place.ubicacion ? { ubicacion: place.ubicacion } : {}),
        sinTarjeta,
      };
      const nextPlaces = [
        ...savedPlaces.filter((saved) => !(place.sourceIds || [place.id]).includes(saved.id)),
        placeData,
      ];
      await setDoc(doc(db, "usuarios", user.uid), { lugares: nextPlaces }, { merge: true });
      setSavedPlaces(nextPlaces);
      setPlaces((current) => current.map((item) =>
        item.id === place.id
          ? { ...item, ...placeData, tieneRelacion: sinTarjeta || Boolean(placeData.nombreLegal) }
          : item
      ));
      showToast(
        sinTarjeta
          ? `“${place.nombreLugar}” marcado como lugar sin tarjeta`
          : "El lugar volverá a requerir un nombre legal",
        "success"
      );
    } catch (error) {
      console.error("Error actualizando la configuración del lugar:", error);
      showToast("No se pudo actualizar el lugar", "error");
    } finally {
      setSavingId("");
    }
  };

  if (!isOpen) return null;

  return (
    <main className="lugares-page">
      <header className="lugares-header">
        <div>
          <span className="lugares-eyebrow">Tus comercios y ubicaciones</span>
          <h1>Lugares</h1>
          <p>Relaciona el nombre legal que aparece en Wallet o en el datáfono con el nombre que reconoces.</p>
        </div>
        <label className="lugares-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar lugar o nombre legal"
            aria-label="Buscar lugar o nombre legal"
          />
        </label>
      </header>

      {loading ? (
        <Loading message="Buscando lugares en tus movimientos..." />
      ) : filteredPlaces.length ? (
        <>
          <PlaceAccordion
            id="lugares-unassigned"
            title="Sin nombre legal asignado"
            description="Relaciona estos lugares con el nombre que aparece en Wallet o en el datáfono."
            count={unassignedPlaces.length}
            expanded={Boolean(expandedSections.unassigned)}
            onToggle={() => toggleSection("unassigned")}
          >
            {unassignedPlaces.length ? (
              <div className="lugares-list">
                {unassignedPlaces.map((place) => (
                  <PlaceCard
                    key={place.id}
                    place={place}
                    saving={savingId === place.id}
                    onChange={updatePlace}
                    onCoordinatesChange={updateCoordinates}
                    onSave={savePlace}
                    onSetNoCard={setNoCard}
                  />
                ))}
              </div>
            ) : <p className="lugares-group__empty">Todos los lugares encontrados ya tienen una relación.</p>}
          </PlaceAccordion>
          <PlaceAccordion
            id="lugares-legal"
            title="Con nombre legal"
            description="Lugares asociados con el nombre de Wallet o del datáfono."
            count={legalNamePlaces.length}
            expanded={Boolean(expandedSections.legal)}
            onToggle={() => toggleSection("legal")}
          >
            {legalNamePlaces.length ? (
              <div className="lugares-list">
                {legalNamePlaces.map((place) => (
                  <PlaceCard
                    key={place.id}
                    place={place}
                    saving={savingId === place.id}
                    onChange={updatePlace}
                    onCoordinatesChange={updateCoordinates}
                    onSave={savePlace}
                    onSetNoCard={setNoCard}
                  />
                ))}
              </div>
            ) : <p className="lugares-group__empty">No hay lugares con nombre legal asignado.</p>}
          </PlaceAccordion>
          <PlaceAccordion
            id="lugares-no-card"
            title="Sin tarjeta"
            description="Lugares configurados sin relación de tarjeta."
            count={noCardPlaces.length}
            expanded={Boolean(expandedSections.noCard)}
            onToggle={() => toggleSection("noCard")}
          >
            {noCardPlaces.length ? (
              <div className="lugares-list">
                {noCardPlaces.map((place) => (
                  <PlaceCard
                    key={place.id}
                    place={place}
                    saving={savingId === place.id}
                    onChange={updatePlace}
                    onCoordinatesChange={updateCoordinates}
                    onSave={savePlace}
                    onSetNoCard={setNoCard}
                  />
                ))}
              </div>
            ) : <p className="lugares-group__empty">No hay lugares marcados como sin tarjeta.</p>}
          </PlaceAccordion>
        </>
      ) : (
        <div className="lugares-empty">
          <MapPin size={30} aria-hidden="true" />
          <h2>{search ? "No encontramos lugares" : "Todavía no hay lugares"}</h2>
          <p>
            {search
              ? "Prueba con otro nombre."
              : "Cuando tus movimientos tengan un comercio registrado, aparecerá aquí para que puedas relacionarlo."}
          </p>
        </div>
      )}
    </main>
  );
};

const PlaceAccordion = ({ id, title, description, count, expanded, onToggle, children }) => (
  <section className="lugares-group">
    <button
      type="button"
      className="lugares-group__toggle"
      aria-expanded={expanded}
      aria-controls={`${id}-content`}
      onClick={onToggle}
    >
      <span className="lugares-group__label">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </span>
      <span className="lugares-group__count">{count}</span>
      <ChevronDown
        className={`lugares-group__chevron${expanded ? " lugares-group__chevron--expanded" : ""}`}
        size={20}
        aria-hidden="true"
      />
    </button>
    {expanded && (
      <div id={`${id}-content`} className="lugares-group__content">
        {children}
      </div>
    )}
  </section>
);

const PlaceCard = ({
  place,
  saving,
  onChange,
  onCoordinatesChange,
  onSave,
  onSetNoCard,
}) => (
  <article className="lugar-card">
    <div className="lugar-card__heading">
      <span className="lugar-card__icon"><Store size={20} aria-hidden="true" /></span>
      <div>
        <strong>{place.nombreLugar || place.nombreLegal}</strong>
        <span>{place.movimientos} {place.movimientos === 1 ? "movimiento" : "movimientos"}</span>
      </div>
    </div>
    {place.sinTarjeta && <span className="lugar-card__status">Lugar sin tarjeta</span>}
    <label className="lugar-card__field">
      <span>Nombre del lugar</span>
      <input
        value={place.nombreLugar}
        onChange={(event) => onChange(place.id, "nombreLugar", event.target.value)}
        placeholder="Ej. KFC Cabecera"
      />
    </label>
    {!place.sinTarjeta && (
      <label className="lugar-card__field">
        <span>Nombre legal (Wallet / datáfono)</span>
        <input
          value={place.nombreLegal}
          onChange={(event) => onChange(place.id, "nombreLegal", event.target.value)}
          placeholder="Nombre que informa el comercio"
        />
      </label>
    )}
    <label className="lugar-card__field">
      <span>Coordenadas (latitud, longitud)</span>
      <input
        type="text"
        inputMode="text"
        value={place.coordenadasInput ?? (place.ubicacion
          ? `${place.ubicacion.latitud}, ${place.ubicacion.longitud}`
          : "")}
        onChange={(event) => onCoordinatesChange(place.id, event.target.value)}
        placeholder="7.100471656254416, -73.10723809468608"
        aria-label={`Coordenadas de ${place.nombreLugar || place.nombreLegal}`}
      />
      <small>Los movimientos dentro de un radio de 50 metros se asociarán con este lugar.</small>
    </label>
    <div className="lugar-card__footer">
      {place.ubicacion ? (
        <a
          href={`https://www.google.com/maps?q=${place.ubicacion.latitud},${place.ubicacion.longitud}`}
          target="_blank"
          rel="noreferrer"
          className="lugar-card__location"
        >
          <MapPin size={16} aria-hidden="true" />
          Ver ubicación
        </a>
      ) : <span className="lugar-card__location lugar-card__location--empty">Sin ubicación registrada</span>}
      <div className="lugar-card__actions">
        <button
          type="button"
          className="lugar-card__no-card"
          onClick={() => onSetNoCard(place, !place.sinTarjeta)}
          disabled={saving}
        >
          {place.sinTarjeta ? "Volver a pedir nombre legal" : "Marcar sin tarjeta"}
        </button>
        <button type="button" onClick={() => onSave(place)} disabled={saving}>
          {saving ? "Guardando..." : place.sinTarjeta ? "Guardar lugar" : "Guardar relación"}
        </button>
      </div>
    </div>
  </article>
);

export default Lugar;
