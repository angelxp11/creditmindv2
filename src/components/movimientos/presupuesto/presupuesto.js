import React, { useEffect, useState } from "react";
import { auth, db } from "../../../server/api";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { showToast } from "../../../resources/toastcontainer/ToastContainer";
import "./presupuesto.css";

const normalizeTags = (rawValue = []) => {
  const values = Array.isArray(rawValue) ? rawValue : String(rawValue ?? "").split(/[\n,]+/);

  return Array.from(
    new Set(
      values
        .map((tag) => String(tag).trim().replace(/,$/, "").toUpperCase())
        .filter(Boolean)
    )
  );
};

const formatMoney = (value) => {
  const number = Number(value || 0);
  const abs = String(Math.abs(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return number < 0 ? `-${abs}` : abs;
};

const formatDateLabel = (value) => {
  if (!value) return "Sin fecha";

  try {
    const dateObject = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(dateObject.getTime())) {
      return "Sin fecha";
    }

    return dateObject.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch (error) {
    return "Sin fecha";
  }
};

const formatDateRangeLabel = (startDate, endDate) => {
  const start = formatDateLabel(startDate);
  const end = formatDateLabel(endDate);

  if (start === "Sin fecha" && end === "Sin fecha") {
    return "Sin rango";
  }

  if (start === "Sin fecha") return end;
  if (end === "Sin fecha") return start;

  return `${start} a ${end}`;
};

const movementMatchesBudget = (budget, movement, extraTags = []) => {
  if (!budget || !movement) {
    return false;
  }

  const budgetTags = normalizeTags([
    ...(Array.isArray(budget.tags) ? budget.tags : []),
    ...extraTags,
  ]);
  const movementTags = normalizeTags(movement.tags || []);
  const budgetNames = [
    budget.categoriaGlobal,
    budget.categoriaNombre,
    budget.establecimiento,
    ...(Array.isArray(budget.tags) ? budget.tags : []),
    ...extraTags,
  ].map((value) => String(value ?? "").trim().toUpperCase());
  const movementNames = [
    movement.categoriaGlobal,
    movement.categoriaNombre,
    movement.establecimiento,
    ...(Array.isArray(movement.tags) ? movement.tags : []),
  ].map((value) => String(value ?? "").trim().toUpperCase());

  return (
    budgetNames.some((name) => name && movementNames.includes(name)) ||
    budgetTags.some((tag) => movementTags.includes(tag)) ||
    movementTags.some((tag) => budgetTags.includes(tag))
  );
};

const Presupuesto = ({ isOpen, onClose }) => {
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedCuentaId, setSelectedCuentaId] = useState("");
  const [budgets, setBudgets] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formValues, setFormValues] = useState({ nombre: "", subcategoria: "" });
  const [budgetForm, setBudgetForm] = useState({
    categoriaId: "",
    valor: "",
    fechaInicio: "",
    fechaFin: "",
    nota: "",
  });
  const [editingBudgetId, setEditingBudgetId] = useState(null);
  const [budgetNoteText, setBudgetNoteText] = useState("");
  const [selectedCategoryTags, setSelectedCategoryTags] = useState([]);
  const [editingCategoryId, setEditingCategoryId] = useState("");

  const selectedAccount = accounts.find((account) => account.id === selectedCuentaId) || null;
  const visibleCategories = selectedCuentaId
    ? categories.filter((category) => category.cuentaId === selectedCuentaId)
    : categories;
  const categoryGlobalOptions = Array.from(
    new Set(
      visibleCategories
        .map((category) => String(category.categoriaGlobal || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));
  const subcategoryOptions = formValues.nombre
    ? Array.from(
        new Set(
          visibleCategories
            .filter((category) => String(category.categoriaGlobal || "").trim() === formValues.nombre)
            .map((category) => String(category.subcategoria || "").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, "es"))
    : [];
  const usedAccountTags = selectedCuentaId
    ? normalizeTags(
        visibleCategories
          .flatMap((category) => category.tags || [])
      )
    : [];
  const accountTags = selectedCuentaId
    ? normalizeTags(
        movements
          .filter((movement) => movement.cuentaId === selectedCuentaId)
          .flatMap((movement) => movement.tags || [])
          .filter((tag) => !usedAccountTags.includes(tag))
      )
    : [];

  useEffect(() => {
    const fetchData = async () => {
      const user = auth.currentUser;
      if (!user || !isOpen) {
        return;
      }

      setLoading(true);
      try {
        const accountsQuery = query(
          collection(db, "cuentas"),
          where("usuarioId", "==", user.uid)
        );
        const accountsSnapshot = await getDocs(accountsQuery);
        const accountList = accountsSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));

        setAccounts(accountList);
        setSelectedCuentaId((currentSelectedId) => currentSelectedId || accountList[0]?.id || "");

        const categoriesQuery = query(
          collection(db, "categorias"),
          where("usuarioId", "==", user.uid)
        );
        const categoriesSnapshot = await getDocs(categoriesQuery);
        const categoryList = categoriesSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
        setCategories(categoryList);

        const budgetsQuery = query(
          collection(db, "presupuestos"),
          where("usuarioId", "==", user.uid)
        );
        const budgetsSnapshot = await getDocs(budgetsQuery);

        const budgetList = budgetsSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => {
            const aDate = a.fechaFin || a.fechaProgramada || "";
            const bDate = b.fechaFin || b.fechaProgramada || "";
            return String(bDate).localeCompare(String(aDate));
          });

        const movementsQuery = query(
          collection(db, "movimientos"),
          where("userId", "==", user.uid)
        );
        const movementsSnapshot = await getDocs(movementsQuery);
        const movementList = movementsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

        setBudgets(budgetList);
        setMovements(movementList);
      } catch (error) {
        console.error("Error cargando cuentas, categorías y presupuestos:", error);
        showToast("No se pudieron cargar las cuentas, categorías o presupuestos", "error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormValues((prev) => {
      if (name === "nombre" && prev.nombre !== value) {
        return { ...prev, nombre: value, subcategoria: "" };
      }
      return { ...prev, [name]: value };
    });
  };

  const handleAccountChange = (event) => {
    const nextCuentaId = event.target.value;
    setSelectedCuentaId(nextCuentaId);
    setSelectedCategoryTags([]);
    setEditingCategoryId("");
    setFormValues({ nombre: "", subcategoria: "" });
  };

  const clearCategoryForm = () => {
    setEditingCategoryId("");
    setSelectedCategoryTags([]);
    setFormValues({ nombre: "", subcategoria: "" });
  };

  const toggleCategoryTag = (tag) => {
    setSelectedCategoryTags((prev) => {
      const exists = prev.includes(tag);
      return exists ? prev.filter((currentTag) => currentTag !== tag) : normalizeTags([...prev, tag]);
    });
  };

  const handleCreateCategory = async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    const categoriaGlobal = formValues.nombre.trim();
    const subcategoria = formValues.subcategoria.trim();
    const tags = normalizeTags(selectedCategoryTags);

    if (!user) {
      showToast("Necesitas iniciar sesión", "error");
      return;
    }

    if (!selectedCuentaId) {
      showToast("Primero selecciona una cuenta", "error");
      return;
    }

    if (!categoriaGlobal) {
      showToast("Selecciona una categoría global", "error");
      return;
    }

    if (!subcategoria) {
      showToast("Selecciona una subcategoría", "error");
      return;
    }

    const categoryGlobalMatches = visibleCategories.filter(
      (category) =>
        category.id !== editingCategoryId &&
        String(category.categoriaGlobal || "").trim().toUpperCase() === categoriaGlobal.toUpperCase()
    );
    const duplicateCategory = categoryGlobalMatches.some(
      (category) =>
        String(category.subcategoria || "").trim().toUpperCase() === subcategoria.toUpperCase()
    );

    if (duplicateCategory) {
      showToast("Esta categoría y subcategoría ya existen para esta cuenta", "error");
      return;
    }

    if (tags.length === 0) {
      showToast("Selecciona al menos un tag para la categoría", "error");
      return;
    }

    const existingTags = categories
      .filter((category) => category.id !== editingCategoryId)
      .flatMap((category) => category.tags || []);
    const duplicatedTags = tags.filter((tag) => existingTags.includes(tag));
    if (duplicatedTags.length > 0) {
      showToast(`El tag ${duplicatedTags[0]} ya pertenece a otra categoría de esta cuenta`, "error");
      return;
    }

    try {
      const categoryData = {
        usuarioId: user.uid,
        categoriaGlobal,
        subcategoria,
        nombre: `${categoriaGlobal} / ${subcategoria}`,
        tags,
        cuentaId: selectedCuentaId,
        cuentaNombre: selectedAccount?.nombre || "",
        bancoNombre: selectedAccount?.banco || "",
        fechaCreacion: serverTimestamp(),
      };

      if (editingCategoryId) {
        await updateDoc(doc(db, "categorias", editingCategoryId), categoryData);
        setCategories((prev) =>
          prev.map((category) =>
            category.id === editingCategoryId ? { ...category, ...categoryData } : category
          )
        );
        showToast("Categoría actualizada correctamente", "success");
      } else {
        const categoryRef = await addDoc(collection(db, "categorias"), categoryData);
        const createdCategory = { id: categoryRef.id, ...categoryData };
        setCategories((prev) => [createdCategory, ...prev]);
        showToast("Categoría guardada correctamente", "success");
      }

      clearCategoryForm();
    } catch (error) {
      console.error("Error guardando categoría:", error);
      showToast("No se pudo guardar la categoría", "error");
    }
  };

  const handleEditCategory = (category) => {
    setEditingCategoryId(category.id);
    setFormValues({
      nombre: category.categoriaGlobal || "",
      subcategoria: category.subcategoria || "",
    });
    setSelectedCategoryTags(normalizeTags(category.tags || []));
  };

  const formatBudgetValue = (value) => {
    const digits = String(value ?? "").replace(/[^\d]/g, "");
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  const hasBalanceGap = selectedAccount && budgetForm.valor
    ? Number(selectedAccount.saldo || 0) < Number(String(budgetForm.valor).replace(/\./g, ""))
    : false;

  const handleBudgetFormChange = (event) => {
    const { name, value } = event.target;
    if (name === "valor") {
      setBudgetForm((prev) => ({ ...prev, valor: formatBudgetValue(value) }));
      return;
    }

    setBudgetForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetBudgetForm = () => {
    const today = new Date().toISOString().slice(0, 10);
    setBudgetForm({
      categoriaId: "",
      valor: "",
      fechaInicio: today,
      fechaFin: today,
      nota: "",
    });
    setEditingBudgetId(null);
    setBudgetNoteText("");
  };

  const getBudgetSpent = (budget) => {
    const creationDate = budget.fechaCreacion?.toDate
      ? budget.fechaCreacion.toDate()
      : new Date(budget.fechaCreacion || Date.now());
    const budgetEndDate = budget.fechaFin ? new Date(`${budget.fechaFin}T23:59:59`) : creationDate;
    const relatedCategory = categories.find((category) => {
      const sameCategoryId = budget.categoriaId && category.id === budget.categoriaId;
      const sameCategoryName =
        String(category.categoriaGlobal || category.nombre || "").trim().toUpperCase() ===
        String(budget.categoriaGlobal || budget.categoriaNombre || budget.establecimiento || "").trim().toUpperCase();
      return sameCategoryId || sameCategoryName;
    });
    const relatedTags = normalizeTags([
      ...(Array.isArray(budget.tags) ? budget.tags : []),
      ...(Array.isArray(relatedCategory?.tags) ? relatedCategory.tags : []),
    ]);

    return movements
      .filter((movement) => movement.cuentaId === budget.cuentaId)
      .filter((movement) => {
        if (!movement.fechaHora) {
          return false;
        }

        const movementDate = new Date(
          movement.fechaHora?.seconds ? movement.fechaHora.toDate() : movement.fechaHora
        );

        return movementDate >= creationDate && movementDate <= budgetEndDate && movementMatchesBudget(budget, movement, relatedTags);
      })
      .reduce((total, movement) => total + Math.abs(Number(movement.valor || 0)), 0);
  };

  const getBudgetRemaining = (budget) => {
    const budgetValue = Number(budget.valor || 0);
    return budgetValue - getBudgetSpent(budget);
  };

  const getBudgetMovements = (budget) => {
    const creationDate = budget.fechaCreacion?.toDate
      ? budget.fechaCreacion.toDate()
      : new Date(budget.fechaCreacion || Date.now());
    const budgetEndDate = budget.fechaFin ? new Date(`${budget.fechaFin}T23:59:59`) : creationDate;
    const relatedCategory = categories.find((category) => {
      const sameCategoryId = budget.categoriaId && category.id === budget.categoriaId;
      const sameCategoryName =
        String(category.categoriaGlobal || category.nombre || "").trim().toUpperCase() ===
        String(budget.categoriaGlobal || budget.categoriaNombre || budget.establecimiento || "").trim().toUpperCase();
      return sameCategoryId || sameCategoryName;
    });
    const relatedTags = normalizeTags([
      ...(Array.isArray(budget.tags) ? budget.tags : []),
      ...(Array.isArray(relatedCategory?.tags) ? relatedCategory.tags : []),
    ]);

    return movements
      .filter((movement) => movement.cuentaId === budget.cuentaId)
      .filter((movement) => {
        if (!movement.fechaHora) {
          return false;
        }

        const movementDate = new Date(
          movement.fechaHora?.seconds ? movement.fechaHora.toDate() : movement.fechaHora
        );

        return movementDate >= creationDate && movementDate <= budgetEndDate && movementMatchesBudget(budget, movement, relatedTags);
      })
      .sort((a, b) => {
        const aDate = a.fechaHora?.seconds ? a.fechaHora.toDate() : new Date(a.fechaHora || 0);
        const bDate = b.fechaHora?.seconds ? b.fechaHora.toDate() : new Date(b.fechaHora || 0);
        return new Date(bDate) - new Date(aDate);
      });
  };

  const handleRenewBudget = async (budget) => {
    const nextExpiration = new Date();
    nextExpiration.setMonth(nextExpiration.getMonth() + 1);
    const nextDate = nextExpiration.toISOString().slice(0, 10);

    try {
      await updateDoc(doc(db, "presupuestos", budget.id), {
        fechaCreacion: serverTimestamp(),
        fechaFin: nextDate,
        fechaInicio: new Date().toISOString().slice(0, 10),
        estado: "pendiente",
        gastoReal: 0,
        montoRestante: Number(budget.valor || 0),
        fechaCierre: null,
      });

      setBudgets((prev) =>
        prev.map((item) =>
          item.id === budget.id
            ? {
                ...item,
                fechaCreacion: new Date(),
                fechaInicio: new Date().toISOString().slice(0, 10),
                fechaFin: nextDate,
                estado: "pendiente",
                gastoReal: 0,
                montoRestante: Number(item.valor || 0),
                fechaCierre: null,
              }
            : item
        )
      );
      showToast("Presupuesto renovado correctamente", "success");
    } catch (error) {
      console.error("Error renovando presupuesto:", error);
      showToast("No se pudo renovar el presupuesto", "error");
    }
  };

  const handleCloseBudget = async (budget) => {
    const gastoReal = getBudgetSpent(budget);
    const montoRestante = Number(budget.valor || 0) - gastoReal;

    if (!window.confirm("¿Deseas liquidar este presupuesto y guardar el monto real gastado?")) {
      return;
    }

    try {
      await updateDoc(doc(db, "presupuestos", budget.id), {
        estado: "cerrado",
        gastoReal,
        montoRestante,
        fechaCierre: serverTimestamp(),
        ultimaActualizacion: serverTimestamp(),
      });

      setBudgets((prev) =>
        prev.map((item) =>
          item.id === budget.id
            ? {
                ...item,
                estado: "cerrado",
                gastoReal,
                montoRestante,
              }
            : item
        )
      );
      showToast("Presupuesto liquidado correctamente", "success");
    } catch (error) {
      console.error("Error cerrando presupuesto:", error);
      showToast("No se pudo liquidar el presupuesto", "error");
    }
  };

  const handleDeleteBudget = async (budget) => {
    if (!window.confirm("¿Deseas eliminar este presupuesto?")) {
      return;
    }

    try {
      await deleteDoc(doc(db, "presupuestos", budget.id));
      setBudgets((prev) => prev.filter((item) => item.id !== budget.id));
      showToast("Presupuesto eliminado", "success");
    } catch (error) {
      console.error("Error eliminando presupuesto:", error);
      showToast("No se pudo eliminar el presupuesto", "error");
    }
  };

  const handleEditBudgetNote = (budget) => {
    setEditingBudgetId(budget.id);
    setBudgetNoteText(budget.nota || "");
  };

  const handleSaveBudgetNote = async () => {
    if (!editingBudgetId) return;

    try {
      await updateDoc(doc(db, "presupuestos", editingBudgetId), {
        nota: budgetNoteText.trim(),
        ultimaActualizacion: serverTimestamp(),
      });

      setBudgets((prev) =>
        prev.map((budget) =>
          budget.id === editingBudgetId ? { ...budget, nota: budgetNoteText.trim() } : budget
        )
      );

      showToast("Nota del presupuesto actualizada", "success");
      setEditingBudgetId(null);
      setBudgetNoteText("");
    } catch (error) {
      console.error("Error actualizando la nota del presupuesto:", error);
      showToast("No se pudo actualizar la nota", "error");
    }
  };

  const handleCreateBudget = async () => {
    const user = auth.currentUser;
    const valor = Number(String(budgetForm.valor).replace(/\./g, ""));
    const categoriaSeleccionada = categories.find((item) => item.id === budgetForm.categoriaId) || null;
    const categoriaGlobalNombre = categoriaSeleccionada ? categoriaSeleccionada.categoriaGlobal || categoriaSeleccionada.nombre : "";

    if (!user) {
      showToast("Necesitas iniciar sesión", "error");
      return;
    }

    if (!selectedCuentaId) {
      showToast("Selecciona una cuenta para crear el presupuesto", "error");
      return;
    }

    if (!budgetForm.categoriaId) {
      showToast("Selecciona una categoría para el presupuesto", "error");
      return;
    }

    if (!valor || !budgetForm.fechaInicio || !budgetForm.fechaFin) {
      showToast("Completa el valor, la fecha de inicio y la fecha final del presupuesto", "error");
      return;
    }

    if (new Date(budgetForm.fechaFin) < new Date(budgetForm.fechaInicio)) {
      showToast("La fecha final no puede ser menor que la fecha de inicio", "error");
      return;
    }

    const cuentaSeleccionada = accounts.find((item) => item.id === selectedCuentaId);
    if (!cuentaSeleccionada) {
      showToast("La cuenta seleccionada no existe", "error");
      return;
    }

    try {
      const budgetData = {
        usuarioId: user.uid,
        cuentaId: selectedCuentaId,
        cuentaNombre: cuentaSeleccionada.nombre,
        cuentaBanco: cuentaSeleccionada.banco,
        categoriaId: categoriaSeleccionada?.id || null,
        categoriaGlobal: categoriaGlobalNombre,
        categoriaNombre: categoriaGlobalNombre || categoriaSeleccionada?.nombre || "",
        valor,
        establecimiento: categoriaGlobalNombre || categoriaSeleccionada?.nombre || "",
        tags: normalizeTags(categoriaSeleccionada?.tags || []),
        fechaInicio: budgetForm.fechaInicio,
        fechaFin: budgetForm.fechaFin,
        nota: budgetForm.nota.trim(),
        estado: "pendiente",
        fechaCreacion: serverTimestamp(),
      };

      const budgetRef = await addDoc(collection(db, "presupuestos"), budgetData);
      setBudgets((prev) => [{ id: budgetRef.id, ...budgetData }, ...prev]);
      resetBudgetForm();
      showToast("Presupuesto creado correctamente", "success");
    } catch (error) {
      console.error("Error creando presupuesto:", error);
      showToast("No se pudo crear el presupuesto", "error");
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="presupuesto-page">
      <div className="presupuesto-panel">
        <div className="presupuesto-header">
          <div className="presupuesto-header__text">
            <h2>Presupuestos y categorías</h2>
            <p>
              Organiza tus tags, mantén cada presupuesto agrupado y asocia cada gasto a su categoría.
            </p>
          </div>
          <button type="button" className="presupuesto-close" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="presupuesto-grid">
          <section className="presupuesto-card"> 
            <div className="presupuesto-card__heading">
              <h3>Cuenta</h3>
              <span>{accounts.length}</span>
            </div>

            <form className="presupuesto-form" onSubmit={handleCreateCategory}>
              <label className="presupuesto-field">
                <span>Cuenta seleccionada</span>
                <select
                  className="presupuesto-select"
                  value={selectedCuentaId}
                  onChange={handleAccountChange}
                >
                  {accounts.length === 0 ? (
                    <option value="">No hay cuentas</option>
                  ) : (
                    accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.banco} · {account.nombre}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="presupuesto-field">
                <span>Categoría global</span>
                <input
                  className="presupuesto-input"
                  list="global-category-list"
                  name="nombre"
                  type="text"
                  value={formValues.nombre}
                  onChange={handleChange}
                  placeholder="Ej. Alimentación"
                  disabled={!selectedCuentaId}
                />
                <datalist id="global-category-list">
                  {categoryGlobalOptions.map((categoryName) => (
                    <option key={categoryName} value={categoryName} />
                  ))}
                </datalist>
              </label>

              <label className="presupuesto-field">
                <span>Subcategoría</span>
                <input
                  className="presupuesto-input"
                  list="subcategory-list"
                  name="subcategoria"
                  type="text"
                  value={formValues.subcategoria}
                  onChange={handleChange}
                  placeholder="Ej. Supermercado"
                  disabled={!selectedCuentaId || !formValues.nombre}
                />
                <datalist id="subcategory-list">
                  {subcategoryOptions.map((subcategoryName) => (
                    <option key={subcategoryName} value={subcategoryName} />
                  ))}
                </datalist>
              </label>

              <div className="presupuesto-field">
                <span>Tags</span>
                <div className="presupuesto-tag-picker">
                  {selectedCuentaId && accountTags.length > 0 ? (
                    accountTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={selectedCategoryTags.includes(tag) ? "presupuesto-tag presupuesto-tag--selected" : "presupuesto-tag"}
                        onClick={() => toggleCategoryTag(tag)}
                      >
                        {tag}
                      </button>
                    ))
                  ) : (
                    <p className="presupuesto-empty">
                      {selectedCuentaId
                        ? "Todos los tags de esta cuenta ya están asignados a otras categorías."
                        : "Selecciona una cuenta para ver sus tags."}
                    </p>
                  )}
                </div>
              </div>

              <div className="presupuesto-form__actions">
                <button type="submit" className="presupuesto-submit" disabled={loading || !selectedCuentaId || selectedCategoryTags.length === 0}>
                  {editingCategoryId ? "Actualizar" : "Guardar"}
                </button>
                {editingCategoryId && (
                  <button type="button" className="presupuesto-cancel" onClick={clearCategoryForm}>
                    Cancelar
                  </button>
                )}
              </div>
            </form>

            <div className="presupuesto-list">
              {visibleCategories.length === 0 ? (
                <p className="presupuesto-empty">Aún no hay categorías creadas para esta cuenta.</p>
              ) : (
                visibleCategories.map((category) => (
                  <article key={category.id} className="presupuesto-item">
                    <div className="presupuesto-item__header">
                      <div>
                        <strong>{category.categoriaGlobal || category.nombre}</strong>
                        <span className="presupuesto-subcategory">{category.subcategoria || "Sin subcategoría"}</span>
                      </div>
                      <button
                        type="button"
                        className="presupuesto-edit"
                        onClick={() => handleEditCategory(category)}
                      >
                        Editar
                      </button>
                    </div>

                    <div className="presupuesto-tags">
                      {(category.tags || []).map((tag) => (
                        <span key={`${category.id}-${tag}`} className="presupuesto-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="presupuesto-card">
            <div className="presupuesto-card__heading">
              <h3>Crear presupuesto</h3>
              <span>{"🗓️"}</span>
            </div>

            {selectedAccount && budgetForm.valor && (
              <div className={hasBalanceGap ? "presupuesto-alert presupuesto-alert--danger" : "presupuesto-alert presupuesto-alert--info"}>
                <strong>Plan futuro:</strong>
                <span>
                  {hasBalanceGap
                    ? `Este presupuesto supera el saldo actual en $${formatMoney(Number(String(budgetForm.valor).replace(/\./g, "")) - Number(selectedAccount.saldo || 0))}.`
                    : `Este presupuesto está dentro del saldo actual disponible: $${formatMoney(selectedAccount.saldo || 0)}.`}
                </span>
                <small>
                  La idea es proyectar el gasto para la fecha elegida, no asumiendo que el dinero ya está disponible hoy.
                </small>
              </div>
            )}

            <div className="presupuesto-budget-form">
              <label className="presupuesto-field">
                <span>Categoría global</span>
                <select
                  className="presupuesto-select"
                  name="categoriaId"
                  value={budgetForm.categoriaId}
                  onChange={handleBudgetFormChange}
                  disabled={!selectedCuentaId}
                >
                  <option value="">Selecciona una categoría</option>
                  {Array.from(
                    new Map(
                      visibleCategories.map((category) => [
                        String(category.categoriaGlobal || category.nombre || "").trim(),
                        category,
                      ])
                    ).values()
                  ).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.categoriaGlobal || category.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <label className="presupuesto-field">
                <span>Valor</span>
                <input
                  className="presupuesto-input"
                  name="valor"
                  type="text"
                  inputMode="numeric"
                  value={budgetForm.valor}
                  onChange={handleBudgetFormChange}
                  placeholder="Ej. 250.000"
                />
              </label>

              <label className="presupuesto-field">
                <span>Fecha de inicio</span>
                <input
                  className="presupuesto-input"
                  name="fechaInicio"
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={budgetForm.fechaInicio}
                  onChange={handleBudgetFormChange}
                />
              </label>

              <label className="presupuesto-field">
                <span>Fecha final</span>
                <input
                  className="presupuesto-input"
                  name="fechaFin"
                  type="date"
                  min={budgetForm.fechaInicio || new Date().toISOString().slice(0, 10)}
                  value={budgetForm.fechaFin}
                  onChange={handleBudgetFormChange}
                />
              </label>

              <label className="presupuesto-field">
                <span>Nota del presupuesto</span>
                <textarea
                  className="presupuesto-input presupuesto-input--textarea"
                  name="nota"
                  value={budgetForm.nota}
                  onChange={handleBudgetFormChange}
                  placeholder="Ej. Comprar laptop, sofá, regalo de cumpleaños..."
                />
              </label>

              <button
                type="button"
                className="presupuesto-submit"
                onClick={handleCreateBudget}
                disabled={loading || !selectedCuentaId}
              >
                Guardar presupuesto
              </button>
            </div>

            <div className="presupuesto-card__heading presupuesto-card__heading--list">
              <h3>Presupuestos pendientes</h3>
              <span>{budgets.length}</span>
            </div>

            <div className="presupuesto-budget-list">
              {budgets.length === 0 ? (
                <p className="presupuesto-empty">No hay presupuestos pendientes.</p>
              ) : (
                budgets.map((budget) => {
                  const budgetMovements = getBudgetMovements(budget);

                  return (
                    <article key={budget.id} className="presupuesto-budget">
                      <div className="presupuesto-budget__main">
                        <strong>{budget.establecimiento || budget.categoriaGlobal || "Presupuesto"}</strong>
                        <span>
                          ${formatMoney(budget.valor)} · {String(budget.cuentaNombre || "Cuenta").toUpperCase()} · {formatDateRangeLabel(budget.fechaInicio, budget.fechaFin)}
                        </span>
                      </div>

                      <div className="presupuesto-budget__tags">
                        {(budget.tags || []).map((tag) => (
                          <span key={`${budget.id}-${tag}`} className="presupuesto-tag presupuesto-tag--soft">
                            {tag}
                          </span>
                        ))}
                      </div>

                      <div className="presupuesto-budget__note">
                        <strong>Nota:</strong>
                        <span>{budget.nota || "Sin nota registrada"}</span>
                      </div>

                      <div className="presupuesto-budget__remaining">
                        {budget.estado === "cerrado" ? (
                          <>
                            Estado: <strong className="presupuesto-status presupuesto-status--closed">Cerrado</strong> ·
                            Gastado: ${formatMoney(Number(budget.gastoReal ?? getBudgetSpent(budget)))} ·
                            Restante: ${formatMoney(Number(budget.montoRestante ?? getBudgetRemaining(budget)))}
                          </>
                        ) : (
                          <>
                            Gastado: ${formatMoney(getBudgetSpent(budget))} · Restante: ${formatMoney(getBudgetRemaining(budget))}
                          </>
                        )}
                      </div>

                      <div className="presupuesto-budget__actions">
                        {budget.estado !== "cerrado" && (
                          <button type="button" className="presupuesto-action presupuesto-action--renew" onClick={() => handleRenewBudget(budget)}>
                            Renovar
                          </button>
                        )}
                        {budget.estado !== "cerrado" && (
                          <button type="button" className="presupuesto-action presupuesto-action--success" onClick={() => handleCloseBudget(budget)}>
                            Liquidar
                          </button>
                        )}
                        <button type="button" className="presupuesto-action presupuesto-action--edit" onClick={() => handleEditBudgetNote(budget)}>
                          Editar nota
                        </button>
                        <button type="button" className="presupuesto-action presupuesto-action--delete" onClick={() => handleDeleteBudget(budget)}>
                          Eliminar
                        </button>
                      </div>

                      {editingBudgetId === budget.id && (
                        <div className="presupuesto-note-editor">
                          <textarea
                            className="presupuesto-input presupuesto-input--textarea"
                            value={budgetNoteText}
                            onChange={(event) => setBudgetNoteText(event.target.value)}
                            placeholder="Escribe lo que quieres comprar o ahorrar para este periodo"
                          />
                          <div className="presupuesto-note-editor__actions">
                            <button type="button" className="presupuesto-submit" onClick={handleSaveBudgetNote}>
                              Guardar nota
                            </button>
                            <button type="button" className="presupuesto-cancel" onClick={() => { setEditingBudgetId(null); setBudgetNoteText(""); }}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="presupuesto-budget__movements">
                        <span className="presupuesto-budget__movements-title">Movimientos en este presupuesto</span>
                        {budgetMovements.length === 0 ? (
                          <p className="presupuesto-empty">No hay movimientos que coincidan con este presupuesto.</p>
                        ) : (
                          <ul className="presupuesto-movement-list">
                            {budgetMovements.map((movement) => (
                              <li key={movement.id || `${movement.fechaHora?.seconds || movement.fechaHora}-${movement.valor}`} className="presupuesto-movement-item">
                                <span>{movement.descripcion || movement.establecimiento || "Movimiento"}</span>
                                <strong>${formatMoney(movement.valor)}</strong>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Presupuesto;
