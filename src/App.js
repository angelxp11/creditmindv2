import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";

import { auth } from "./server/api";

import Login from "./components/login/login";
import Home from "./components/home/home";
import PQR from "./components/pqr/pqr";
import Cuentas from "./components/cuentas/cuentas";
import Deudas from "./components/deudas/deudas";
import Movimientos from "./components/movimientos/movimientos";
import Presupuesto from "./components/movimientos/presupuesto/presupuesto";
import VerMovimientos from "./components/movimientos/vermovimientos/vermovimientos";
import Ingresos from "./components/movimientos/ingresos/ingresos";

import Loading from "./resources/loading/loading";
import ToastContainer from "./resources/toastcontainer/ToastContainer";
import Navbar from "./resources/navbar/navbar";
import ConfirmModal from "./resources/modalquestion/modalquestion";

function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showCuentas, setShowCuentas] = useState(false);
  const [showDeudas, setShowDeudas] = useState(false);
  const [showMovimientos, setShowMovimientos] = useState(false);
  const [showPresupuesto, setShowPresupuesto] = useState(false);
  const [showVerMovimientos, setShowVerMovimientos] = useState(false);
  const [showIngresos, setShowIngresos] = useState(false);

  const [modalData, setModalData] = useState({
    title: "",
    question: "",
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setCheckingAuth(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setShowLogoutModal(false);
    } catch (error) {
      console.error(error);
    }
  };

  if (checkingAuth) {
    return (
      <>
        <ToastContainer />
        <Loading message="Verificando sesión..." />
      </>
    );
  }

  return (
    <>
      <ToastContainer />

      {user ? (
        <>
          <Navbar
            onLogout={(data) => {
              setModalData(data);
              setShowLogoutModal(true);
            }}
            onOpenCuentas={() => {
              setShowCuentas(true);
              setShowDeudas(false);
              setShowMovimientos(false);
              setShowVerMovimientos(false);
              setShowIngresos(false);
            }}
            onOpenDeudas={() => {
              setShowDeudas(true);
              setShowCuentas(false);
              setShowMovimientos(false);
              setShowVerMovimientos(false);
              setShowIngresos(false);
            }}
            onOpenMovimientos={() => {
              setShowMovimientos(true);
              setShowPresupuesto(false);
              setShowCuentas(false);
              setShowDeudas(false);
              setShowVerMovimientos(false);
              setShowIngresos(false);
            }}
            onOpenPresupuesto={() => {
              setShowPresupuesto(true);
              setShowMovimientos(false);
              setShowCuentas(false);
              setShowDeudas(false);
              setShowVerMovimientos(false);
              setShowIngresos(false);
            }}
            onOpenIngresos={() => {
              setShowIngresos(true);
              setShowPresupuesto(false);
              setShowCuentas(false);
              setShowDeudas(false);
              setShowMovimientos(false);
              setShowVerMovimientos(false);
            }}
            onOpenVerMovimientos={() => {
              setShowVerMovimientos(true);
              setShowPresupuesto(false);
              setShowCuentas(false);
              setShowDeudas(false);
              setShowMovimientos(false);
              setShowIngresos(false);
            }}
            onGoHome={() => {
              setShowCuentas(false);
              setShowDeudas(false);
              setShowMovimientos(false);
              setShowPresupuesto(false);
              setShowVerMovimientos(false);
              setShowIngresos(false);
            }}
          />

          <Cuentas
            isOpen={showCuentas}
            onClose={() => setShowCuentas(false)}
          />

          <Deudas
            isOpen={showDeudas}
            onClose={() => setShowDeudas(false)}
          />

          <Movimientos
            isOpen={showMovimientos}
            onClose={() => setShowMovimientos(false)}
          />

          <Presupuesto
            isOpen={showPresupuesto}
            onClose={() => setShowPresupuesto(false)}
          />

          <Ingresos
            isOpen={showIngresos}
            onClose={() => setShowIngresos(false)}
          />

          <VerMovimientos
            isOpen={showVerMovimientos}
            onClose={() => setShowVerMovimientos(false)}
          />

          {!showCuentas &&
            !showDeudas &&
            !showMovimientos &&
            !showPresupuesto &&
            !showVerMovimientos &&
            !showIngresos && <Home />}

          <PQR />

          <ConfirmModal
            isOpen={showLogoutModal}
            title={modalData.title}
            description={modalData.question}
            confirmText="Cerrar sesión"
            cancelText="Cancelar"
            onConfirm={handleLogout}
            onCancel={() => setShowLogoutModal(false)}
          />
        </>
      ) : (
        <Login />
      )}
    </>
  );
}

export default App;