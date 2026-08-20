import React, { useEffect, useState } from "react";
import { auth, db } from "../../server/api";
import { collection, getDocs, query, where } from "firebase/firestore";
import Loading from "../../resources/loading/loading";
import "./home.css";

const BAR_MAX_HEIGHT = 140; // px

const Home = () => {
  const user = auth.currentUser;
  const [defaultAccount, setDefaultAccount] = useState(null);
  const [savingsAccounts, setSavingsAccounts] = useState([]);
  const [budgetedBalance, setBudgetedBalance] = useState(0);
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
          const reserved = budgetsSnapshot.docs
            .map((budgetDoc) => budgetDoc.data())
            .filter(
              (budget) =>
                budget.estado === "pendiente" && budget.cuentaId === account.id
            )
            .reduce((total, budget) => total + Number(budget.valor || 0), 0);
          setBudgetedBalance(reserved);
        } else {
          setBudgetedBalance(0);
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
  const availableBalance = currentBalance - budgetedBalance;
  const formatMoney = (value) => Number(value || 0).toLocaleString("es-CO");

  const maxValue = Math.max(currentBalance, budgetedBalance, Math.abs(availableBalance), 1);
  const getBarHeight = (value) => {
    const pct = Math.max(Math.abs(value), 0) / maxValue;
    // Altura mínima visible del 6% para que la barra nunca "desaparezca" en 0
    const clamped = Math.max(pct, value === 0 ? 0.04 : pct);
    return Math.round(clamped * BAR_MAX_HEIGHT);
  };

  const bars = [
    {
      key: "current",
      label: "Saldo actual",
      value: currentBalance,
      modifier: "home-bar--current",
    },
    {
      key: "reserved",
      label: "Saldo presupuestado",
      value: budgetedBalance,
      modifier: "home-bar--reserved",
    },
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