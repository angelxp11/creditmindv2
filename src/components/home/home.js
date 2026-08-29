import React, { useEffect, useState } from "react";
import { auth, db } from "../../server/api";
import { collection, getDocs, query, where } from "firebase/firestore";
import Loading from "../../resources/loading/loading";
import "./home.css";

const BAR_MAX_HEIGHT = 140; // px

const normalizeTagValue = (value) => String(value ?? "").trim().toUpperCase();

const normalizeTagList = (list = []) => {
  const source = Array.isArray(list) ? list : [];
  return source
    .map((tag) => normalizeTagValue(tag).replace(/,$/, ""))
    .filter(Boolean);
};

const movementMatchesBudget = (budget, movement) => {
  if (!budget || !movement) {
    return false;
  }

  const budgetTags = normalizeTagList(budget.tags);
  const movementTags = normalizeTagList(movement.tags);
  const budgetNames = [
    budget.categoriaGlobal,
    budget.categoriaNombre,
    budget.establecimiento,
    ...(Array.isArray(budget.tags) ? budget.tags : []),
  ].map((value) => normalizeTagValue(value));
  const movementNames = [
    movement.categoriaGlobal,
    movement.categoriaNombre,
    movement.establecimiento,
    ...(Array.isArray(movement.tags) ? movement.tags : []),
  ].map((value) => normalizeTagValue(value));

  return (
    budgetNames.some((name) => name && movementNames.includes(name)) ||
    budgetTags.some((tag) => movementTags.includes(tag)) ||
    movementTags.some((tag) => budgetTags.includes(tag)) ||
    normalizeTagValue(budget.categoriaGlobal || budget.categoriaNombre) ===
      normalizeTagValue(movement.categoriaGlobal || movement.categoriaNombre)
  );
};

const matchingMovementsForBudget = (budget, accountId, movements = [], categoryCatalog = []) => {
  if (!budget || !Array.isArray(movements)) {
    return 0;
  }

  const startValue = budget.fechaCreacion?.toDate
    ? budget.fechaCreacion.toDate()
    : budget.fechaCreacion || budget.fechaProgramada || budget.fechaFin;
  const start = startValue instanceof Date
    ? startValue
    : new Date(`${String(startValue).slice(0, 10)}T00:00:00`);
  const end = budget.fechaFin
    ? new Date(`${budget.fechaFin}T23:59:59`)
    : start;

  const relatedCategory = categoryCatalog.find((category) => {
    const categoryName = normalizeTagValue(category.categoriaGlobal || category.nombre);
    const budgetName = normalizeTagValue(budget.categoriaGlobal || budget.categoriaNombre || budget.establecimiento);
    const sameCategoryId = budget.categoriaId && category.id === budget.categoriaId;
    return sameCategoryId || categoryName === budgetName;
  });
  const extraTags = normalizeTagList([
    ...(Array.isArray(budget.tags) ? budget.tags : []),
    ...(Array.isArray(relatedCategory?.tags) ? relatedCategory.tags : []),
  ]);

  return movements
    .filter((movement) => movement.cuentaId === accountId && movement.fechaHora)
    .filter((movement) => {
      const movementDate = new Date(
        movement.fechaHora?.seconds ? movement.fechaHora.toDate() : movement.fechaHora
      );
      const movementMatches = movementMatchesBudget(budget, movement, extraTags);

      return movementMatches && movementDate >= start && movementDate <= end;
    })
    .reduce((total, movement) => total + Math.abs(Number(movement.valor || 0)), 0);
};

const Home = () => {
  const user = auth.currentUser;
  const [defaultAccount, setDefaultAccount] = useState(null);
  const [savingsAccounts, setSavingsAccounts] = useState([]);
  const [budgetedBalance, setBudgetedBalance] = useState(0);
  const [budgetSpent, setBudgetSpent] = useState(0);
  const [activeBudgetRows, setActiveBudgetRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const fetchDefaultAccount = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const snapshot = await getDocs(
          query(
            collection(db, "cuentas"),
            where("usuarioId", "==", user.uid)
          )
        );
        const accountDocs = snapshot.docs
          .map((accountDoc) => ({ id: accountDoc.id, ...accountDoc.data() }))
          .sort((a, b) => (b.fechaCreacion?.toMillis?.() ?? 0) - (a.fechaCreacion?.toMillis?.() ?? 0));
        const account = accountDocs.find(
          (accountDoc) =>
            accountDoc.esDefault && (accountDoc.tipoCuenta || "gastos") === "gastos"
        ) || accountDocs.find(
          (accountDoc) => (accountDoc.tipoCuenta || "gastos") === "gastos"
        );
        const savings = accountDocs.filter(
          (accountDoc) => accountDoc.tipoCuenta === "ahorros"
        );
        setDefaultAccount(account || null);
        setSavingsAccounts(savings);

        if (account) {
          const budgetsSnapshot = await getDocs(
            query(
              collection(db, "presupuestos"),
              where("usuarioId", "==", user.uid)
            )
          );
          const pendingBudgets = budgetsSnapshot.docs
            .map((budgetDoc) => ({ id: budgetDoc.id, ...budgetDoc.data() }))
            .filter(
              (budget) =>
                budget.estado === "pendiente" &&
                budget.cuentaId === account.id &&
                (budget.fechaFin || budget.fechaCreacion)
            );

          const today = new Date();
          const activeBudgets = pendingBudgets.filter((budget) => {
            const startValue = budget.fechaCreacion?.toDate
              ? budget.fechaCreacion.toDate()
              : budget.fechaCreacion || budget.fechaProgramada || budget.fechaFin;
            const start = startValue instanceof Date
              ? startValue
              : new Date(`${String(startValue).slice(0, 10)}T00:00:00`);
            const end = budget.fechaFin
              ? new Date(`${budget.fechaFin}T23:59:59`)
              : start;
            return today >= start && today <= end;
          });

          const displayBudgets = pendingBudgets.length > 0 ? pendingBudgets : activeBudgets;

          const targetBudge = displayBudgets.reduce(
            (total, budget) => total + Number(budget.valor || 0),
            0
          );

          const categoriesSnapshot = await getDocs(
            query(
              collection(db, "categorias"),
              where("usuarioId", "==", user.uid)
            )
          );
          const categoryList = categoriesSnapshot.docs.map((categoryDoc) => ({
            id: categoryDoc.id,
            ...categoryDoc.data(),
          }));

          const movementsSnapshot = await getDocs(
            query(
              collection(db, "movimientos"),
              where("userId", "==", user.uid)
            )
          );
          const matchingMovements = movementsSnapshot.docs
            .map((movementDoc) => movementDoc.data())
            .filter((movement) => movement.cuentaId === account.id);

          const spentByBudget = displayBudgets.reduce(
            (total, budget) => total + matchingMovementsForBudget(budget, account.id, matchingMovements, categoryList),
            0
          );

          const activeBudgetRowsData = displayBudgets.map((budget) => {
            const spent = matchingMovementsForBudget(budget, account.id, matchingMovements, categoryList);

            return {
              id: budget.id,
              name: budget.categoriaGlobal || budget.categoriaNombre || budget.establecimiento || "Presupuesto",
              target: Number(budget.valor || 0),
              spent,
              remaining: Number(budget.valor || 0) - spent,
            };
          });

          setBudgetedBalance(targetBudge);
          setBudgetSpent(spentByBudget);
          setActiveBudgetRows(activeBudgetRowsData);
        } else {
          setBudgetedBalance(0);
          setBudgetSpent(0);
        }
      } catch (error) {
        console.error("Error cargando la cuenta predeterminada:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDefaultAccount();
  }, [user]);

  // Dispara la animación de las barras una vez que ya hay datos pintados
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => setAnimate(true), 80);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  const currentBalance = Number(defaultAccount?.saldo || 0);
  const budgetTarget = Number(budgetedBalance || 0);
  const budgetProgress = Number(budgetSpent || 0);
  const availableBalance = currentBalance - budgetedBalance;
  const formatMoney = (value) => Number(value || 0).toLocaleString("es-CO");

  const categoryPalette = [
    "home-bar--category-1",
    "home-bar--category-2",
    "home-bar--category-3",
    "home-bar--category-4",
    "home-bar--category-5",
  ];

  const maxValue = Math.max(
    currentBalance,
    budgetTarget,
    budgetProgress,
    ...activeBudgetRows.flatMap((row) => [row.target, row.spent]),
    Math.abs(availableBalance),
    1
  );

  const getBarHeight = (value) => {
    const pct = Math.max(Math.abs(value), 0) / maxValue;
    const clamped = Math.max(pct, value === 0 ? 0.04 : pct);
    return Math.round(clamped * BAR_MAX_HEIGHT);
  };

  const budgetBars = activeBudgetRows.length
    ? activeBudgetRows.map((row, index) => ({
        key: row.id,
        label: row.name,
        value: row.spent,
        modifier: row.spent > row.target ? "home-bar--negative" : categoryPalette[index % categoryPalette.length],
        target: row.target,
        colorClass: categoryPalette[index % categoryPalette.length],
      }))
    : [
        {
          key: "reserved",
          label: "Gasto del presupuesto",
          value: budgetProgress,
          modifier: budgetProgress > budgetTarget ? "home-bar--negative" : "home-bar--reserved",
          target: budgetTarget,
        },
      ];

  const bars = [
    {
      key: "current",
      label: "Saldo actual",
      value: currentBalance,
      modifier: "home-bar--current",
      target: null,
    },
    ...budgetBars,
  ];

  return (
    <div className="home-container">
      {loading && <Loading message="Cargando tu saldo..." />}
      <section className="home-main-account">
        <span className="home-balance__account">
          {defaultAccount
            ? `${defaultAccount.banco} · ${defaultAccount.nombre}`
            : "Cuenta principal"}
        </span>

        {defaultAccount ? (
          <>
          <div className="home-available" aria-live="polite">
            <span className="home-available__label">Saldo disponible</span>
            <strong className={availableBalance < 0 ? "home-available__value home-available__value--negative" : "home-available__value"}>
              ${formatMoney(availableBalance)}
            </strong>
          </div>

          <div className="home-chart">
            {bars.map((bar) => (
              <div className="home-chart__column" key={bar.key}>
                <span className="home-chart__value">
                  ${formatMoney(bar.value)}
                </span>
                <div className="home-chart__track">
                  {bar.target !== null && bar.target > 0 && (
                    <div
                      className={
                        bar.value > bar.target
                          ? "home-chart__budget-target home-chart__budget-target--over"
                          : "home-chart__budget-target"
                      }
                      style={{
                        height: animate ? `${getBarHeight(bar.target)}px` : "0px",
                      }}
                    />
                  )}
                  <div
                    className={`home-chart__bar ${bar.modifier}`}
                    style={{
                      height: animate ? `${getBarHeight(bar.value)}px` : "0px",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {activeBudgetRows.length > 0 && (
            <div className="home-budget-summary">
              <div className="home-budget-summary__header">
                <span>Presupuestos creados</span>
              </div>
              <div className="home-budget-summary__list">
                {activeBudgetRows.map((row, index) => (
                  <div key={row.id} className="home-budget-summary__item">
                    <span className={`home-budget-summary__dot ${categoryPalette[index % categoryPalette.length]}`} />
                    <div className="home-budget-summary__meta">
                      <strong>{row.name}</strong>
                      <span>
                        ${formatMoney(row.spent)} / ${formatMoney(row.target)}
                      </span>
                    </div>
                    <strong className={row.remaining < 0 ? "home-budget-summary__remaining home-budget-summary__remaining--negative" : "home-budget-summary__remaining"}>
                      ${formatMoney(row.remaining)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="home-balances">
            {bars.map((bar) => (
              <div className="home-balance-item" key={bar.key}>
                <span className={`home-balance-item__dot ${bar.modifier}`} />
                <span className="home-balance-item__content">
                  <span className="home-balance-item__label">{bar.label}</span>
                  <strong className="home-balance-item__value">${formatMoney(bar.value)}</strong>
                </span>
              </div>
            ))}
          </div>
        </>
        ) : (
          <p className="home-empty">
            Aún no tienes una cuenta principal configurada.
          </p>
        )}
      </section>

      <section className="home-savings" aria-labelledby="home-savings-title">
        <div className="home-savings__heading">
          <div>
            <span className="home-savings__eyebrow">Ahorro</span>
            <h2 id="home-savings-title">Mis alcancías</h2>
          </div>
          <span className="home-savings__count">{savingsAccounts.length}</span>
        </div>
        {savingsAccounts.length === 0 ? (
          <p className="home-empty">Aún no tienes cuentas de ahorros.</p>
        ) : (
          <div className="home-savings__list">
            {savingsAccounts.map((account) => (
              <article className="home-savings__item" key={account.id}>
                <div className="home-savings__icon" aria-hidden="true">▣</div>
                <div className="home-savings__details">
                  <strong>{account.nombre}</strong>
                  <span>{account.banco}</span>
                </div>
                <strong className="home-savings__value">
                  ${formatMoney(account.saldo)}
                </strong>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Home;