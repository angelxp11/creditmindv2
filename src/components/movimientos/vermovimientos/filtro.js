import React, { useEffect, useState } from "react";
import "./filtro.css";

const toggleValue = (values, value) =>
  values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];

const SelectionChips = ({ values, onRemove }) => (
  <div className="filtro-chips" aria-label="Elementos seleccionados">
    {values.map((value) => (
      <span className="filtro-chip" key={value}>
        {value}
        <button
          type="button"
          className="filtro-chip__remove"
          onClick={() => onRemove(value)}
          aria-label={`Quitar ${value}`}
        >
          ×
        </button>
      </span>
    ))}
  </div>
);

const Filtro = ({
  isOpen,
  onClose,
  availableTags,
  availableConcepts,
  selectedTags,
  selectedConcepts,
  onApply,
  onClear,
}) => {
  const [draftTags, setDraftTags] = useState(selectedTags);
  const [draftConcepts, setDraftConcepts] = useState(selectedConcepts);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (isOpen) {
      setDraftTags(selectedTags);
      setDraftConcepts(selectedConcepts);
      setSearchTerm("");
    }
  }, [isOpen, selectedTags, selectedConcepts]);

  if (!isOpen) return null;

  const handleClear = () => {
    setDraftTags([]);
    setDraftConcepts([]);
    onClear();
  };

  const handleApply = () => {
    onApply(draftTags, draftConcepts);
    onClose();
  };

  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
  const visibleTags = availableTags.filter((tag) =>
    tag.toLocaleLowerCase().includes(normalizedSearch)
  );
  const visibleConcepts = availableConcepts.filter((concept) =>
    concept.toLocaleLowerCase().includes(normalizedSearch)
  );

  return (
    <div className="filtro-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="filtro-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="filtro-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="filtro-header">
          <div>
            <span className="filtro-eyebrow">Historial</span>

        <div className="filtro-search">
          <label htmlFor="filtro-search-input">Buscar</label>
          <input
            id="filtro-search-input"
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Escribe un tag o concepto..."
            autoFocus
          />
        </div>
            <h2 id="filtro-title">Filtrar movimientos</h2>
            <p>Selecciona uno o varios tags y conceptos.</p>
          </div>
          <button className="filtro-close" type="button" onClick={onClose} aria-label="Cerrar filtros">
            ×
          </button>
        </header>

        <div className="filtro-body">
          <fieldset className="filtro-group">
            <legend>Tags</legend>
            <SelectionChips
              values={draftTags}
              onRemove={(tag) => setDraftTags((values) => values.filter((value) => value !== tag))}
            />
            {visibleTags.length === 0 ? (
              <span className="filtro-empty">No hay tags registrados.</span>
            ) : (
              <div className="filtro-options" role="group" aria-label="Opciones de tags">
                {visibleTags.map((tag) => (
                  <button
                    className={`filtro-option ${draftTags.includes(tag) ? "filtro-option--selected" : ""}`}
                    key={tag}
                    type="button"
                    aria-pressed={draftTags.includes(tag)}
                    onClick={() => setDraftTags((values) => toggleValue(values, tag))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="filtro-group">
            <legend>Conceptos</legend>
            <SelectionChips
              values={draftConcepts}
              onRemove={(concept) => setDraftConcepts((values) => values.filter((value) => value !== concept))}
            />
            {visibleConcepts.length === 0 ? (
              <span className="filtro-empty">No hay conceptos registrados.</span>
            ) : (
              <div className="filtro-options" role="group" aria-label="Opciones de conceptos">
                {visibleConcepts.map((concept) => (
                  <button
                    className={`filtro-option ${draftConcepts.includes(concept) ? "filtro-option--selected" : ""}`}
                    key={concept}
                    type="button"
                    aria-pressed={draftConcepts.includes(concept)}
                    onClick={() => setDraftConcepts((values) => toggleValue(values, concept))}
                  >
                    {concept}
                  </button>
                ))}
              </div>
            )}
          </fieldset>
        </div>

        <footer className="filtro-footer">
          <button className="filtro-clear" type="button" onClick={handleClear}>
            Limpiar
          </button>
          <div className="filtro-actions">
            <button className="filtro-cancel" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="filtro-apply" type="button" onClick={handleApply}>
              Aplicar filtros
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};

export default Filtro;
