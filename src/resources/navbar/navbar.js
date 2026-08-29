import React, { useEffect, useState } from "react";
import Configuration from "../../components/configuration/configuration";
import AdminPR from "../../components/pqr/admin/adminpr";
import { auth } from "../../server/api";
import { onAuthStateChanged } from "firebase/auth";
import "./navbar.css";

const ADMIN_EMAIL = "jocheangel728@gmail.com";

/* ── Íconos SVG inline ─────────────────────────── */
const IconHome     = () => <svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 12L12 3l9 9"/><path d="M9 21V12h6v9"/></svg>;
const IconWallet   = () => <svg viewBox="0 0 24 24" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="3"/><path d="M16 3l-4 4-4-4"/><circle cx="16" cy="14" r="1.5" fill="currentColor" stroke="none"/></svg>;
const IconDebt     = () => <svg viewBox="0 0 24 24" strokeWidth="2"><circle cx="12" cy="11" r="8"/><path d="M12 7v8M9 11h6"/><path d="M7 7l-2-2M17 7l2-2"/></svg>;
const IconPay      = () => <svg viewBox="0 0 24 24" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>;
const IconBudget   = () => <svg viewBox="0 0 24 24" strokeWidth="2"><path d="M4 19V5h16v14"/><path d="M8 9h8M8 13h8M8 17h5"/><path d="M4 10h16"/></svg>;
const IconList     = () => <svg viewBox="0 0 24 24" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>;
const IconSettings = () => <svg viewBox="0 0 24 24" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
const IconLogout   = () => <svg viewBox="0 0 24 24" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
const IconAdmin    = () => <svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>;
const IconCredit   = () => <svg viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 6v6l4 2"/></svg>;

/* ── Botón desktop ─────────────────────────────── */
const NavBtn = ({ icon, label, onClick, className = "" }) => (
  <button className={`nav-btn ${className}`} onClick={onClick}>
    {icon}
    {label}
  </button>
);

/* ── Botón mobile ──────────────────────────────── */
const MobileBtn = ({ icon, label, onClick, className = "" }) => (
  <button className={`nav-mobile-btn ${className}`} onClick={onClick}>
    {icon}
    <span className="nav-mobile-btn__label">{label}</span>
    <span className="nav-mobile-btn__arrow">›</span>
  </button>
);

/* ── Componente principal ──────────────────────── */
const Navbar = ({ onLogout, onOpenCuentas, onOpenDeudas, onOpenMovimientos, onOpenPresupuesto, onOpenVerMovimientos, onOpenIngresos, onGoHome }) => {
  const [open, setOpen]           = useState(false);
  const [showNavbar, setShowNavbar] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [showAdminPR, setShowAdminPR] = useState(false);
  const [isAdmin, setIsAdmin]     = useState(false);

  /* Ocultar navbar al hacer scroll hacia abajo */
  useEffect(() => {
    let lastScroll = 0;
    const handleScroll = () => {
      const cur = window.pageYOffset;
      setShowNavbar(cur <= lastScroll || cur <= 80);
      lastScroll = cur;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  /* Detectar admin */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) =>
      setIsAdmin(!!(user && user.email === ADMIN_EMAIL))
    );
    return () => unsub();
  }, []);

  /* Bloquear scroll del body cuando el menú mobile está abierto */
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const close = () => setOpen(false);

  const handleLogout = () => {
    close();
    onLogout({ title: "¿Cerrar sesión?", question: "Si continúas, tu sesión actual se cerrará." });
  };

  const handleConfig = () => { close(); setShowConfig(true); };
  const handleAdmin  = () => { close(); setShowAdminPR(true); };

  return (
    <>
      <div className="navbar-spacer" />

      {/* ── NAVBAR DESKTOP ── */}
      <nav className={`navbar ${showNavbar ? "visible" : "hidden"}`}>

        {/* Logo */}
        <div className="nav-logo">
          <div className="nav-logo__icon">
            <IconCredit />
          </div>
          <span className="nav-logo__wordmark">
            Credit<em>Mind</em>
          </span>
        </div>

        {/* Menú desktop */}
        <div className="navbar-desktop">
          <NavBtn icon={<IconHome />}   label="Inicio" onClick={() => { close(); onGoHome && onGoHome(); }} />
          <NavBtn icon={<IconWallet />} label="Cuentas"         onClick={() => { close(); onOpenCuentas(); }} />
          <NavBtn icon={<IconDebt />}   label="Deudas"          onClick={() => { close(); onOpenDeudas && onOpenDeudas(); }} />
          <NavBtn icon={<IconBudget />} label="Presupuesto"     onClick={() => { close(); onOpenPresupuesto && onOpenPresupuesto(); }} />
          <NavBtn icon={<IconPay />}    label="Pagar"           onClick={() => { close(); onOpenMovimientos(); }} />
          <NavBtn icon={<IconPay />}    label="Ingresos"        onClick={() => { close(); onOpenIngresos && onOpenIngresos(); }} />
          <NavBtn icon={<IconList />}   label="Movimientos"     onClick={() => { close(); onOpenVerMovimientos(); }} />
          {isAdmin && (
            <NavBtn icon={<IconAdmin />} label="Solicitudes" onClick={handleAdmin} className="nav-btn--admin" />
          )}
          <NavBtn icon={<IconSettings />} label="Configuración" onClick={handleConfig} className="nav-btn--sep" />
          <NavBtn icon={<IconLogout />}   label="Salir"         onClick={handleLogout} className="nav-btn--logout" />
        </div>
      </nav>

      {/* ── HAMBURGER ── */}
      <button
        className={`hamburger ${open ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Cerrar menú" : "Abrir menú"}
        style={{ position: "fixed", top: "13px", right: "16px", zIndex: 1005 }}
      >
        <span className="hamburger__bar" />
        <span className="hamburger__bar" />
        <span className="hamburger__bar" />
      </button>

      {/* ── OVERLAY ── */}
      <div className={`mobile-overlay ${open ? "show" : ""}`} onClick={close} />

      {/* ── DRAWER MOBILE ── */}
      <div className={`mobile-menu ${open ? "show" : ""}`}>

        <div className="mobile-menu__header">
          <div className="nav-logo">
            <div className="nav-logo__icon">
              <IconCredit />
            </div>
            <span className="nav-logo__wordmark">
              Credit<em>Mind</em>
            </span>
          </div>
        </div>

        <div className="mobile-menu__group">
          <MobileBtn icon={<IconHome />}   label="Inicio"           onClick={() => { close(); onGoHome && onGoHome(); }} />
          <MobileBtn icon={<IconWallet />} label="Cuentas"          onClick={() => { close(); onOpenCuentas(); }} />
          <MobileBtn icon={<IconDebt />}   label="Deudas"           onClick={() => { close(); onOpenDeudas && onOpenDeudas(); }} />
          <MobileBtn icon={<IconBudget />} label="Presupuesto"      onClick={() => { close(); onOpenPresupuesto && onOpenPresupuesto(); }} />
          <MobileBtn icon={<IconPay />}    label="Pagar"            onClick={() => { close(); onOpenMovimientos(); }} />
          <MobileBtn icon={<IconPay />}    label="Ingresos"         onClick={() => { close(); onOpenIngresos && onOpenIngresos(); }} />
          <MobileBtn icon={<IconList />}   label="Ver movimientos"  onClick={() => { close(); onOpenVerMovimientos(); }} />
          {isAdmin && (
            <MobileBtn icon={<IconAdmin />} label="Solicitudes (Admin)" onClick={handleAdmin} className="nav-mobile-btn--admin" />
          )}
        </div>

        <div className="mobile-menu__group">
          <MobileBtn icon={<IconSettings />} label="Configuración"  onClick={handleConfig} />
          <MobileBtn icon={<IconLogout />}   label="Cerrar sesión"  onClick={handleLogout} className="nav-mobile-btn--logout" />
        </div>

      </div>

      {/* ── MODALES ── */}
      <Configuration isOpen={showConfig}  onClose={() => setShowConfig(false)} />
      <AdminPR       isOpen={showAdminPR} onClose={() => setShowAdminPR(false)} />
    </>
  );
};

export default Navbar;