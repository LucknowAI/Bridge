"use client";

/**
 * Login.jsx — AI Community Lucknow · Mr. Bridge
 * Premium dark theme matching the AI Community Lucknow brand.
 * Amber/orange accent palette, Inter typography, glassmorphism cards.
 *
 * Auth is Keycloak-backed:
 *   · Phone  → server resolves the registered e-mail, Resend delivers a
 *              6-digit code and a magic link; either one signs the user in.
 *   · E-mail → the same on-site code and magic-link flow.
 *   · Google → Keycloak brokers Google authentication using kc_idp_hint.
 * No browser-side database client and no auth SDK — every call is a fetch to
 * this app's own API.
 */

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { safeReturnTo } from "../lib/safe-return-to";

const CODE_LENGTH = 6;

// Callback failures come back as ?error=… — map them to human copy.
const ERROR_MESSAGES = {
  unregistered: "That account is not on the attendee list.",
  provider: "Google sign-in failed. Please try again.",
  state_mismatch: "Your sign-in session expired. Please start again.",
  verification_failed: "We couldn't verify that sign-in. Please try again.",
  invalid_callback: "That sign-in link is incomplete. Please try again.",
  no_email: "Google didn't share an e-mail address with us.",
  email_unverified: "Google couldn't verify your email address. Please use an email code.",
  not_found: "That login link has expired. Request a new one.",
  expired: "That login link has expired. Request a new one.",
  already_used: "That login link has already been used.",
};

// ── Particle background (warm amber tones) ─────────────────────
function ParticleBackground() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const setSize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    setSize();
    const nodes = Array.from({ length: 50 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5,
      pulse: Math.random() * Math.PI * 2,
    }));
    let frame;
    const draw = () => {
      ctx.fillStyle = "rgba(10,10,14,0.18)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      nodes.forEach(n => {
        n.x += n.vx; n.y += n.vy; n.pulse += 0.018;
        if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
      });
      nodes.forEach((a, i) => {
        nodes.slice(i + 1).forEach(b => {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 130) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(245,158,11,${(1 - d / 130) * 0.18})`;
            ctx.lineWidth = 0.6;
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        });
        const g = Math.sin(a.pulse) * 0.5 + 0.5;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r + g * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(245,158,11,${0.25 + g * 0.3})`;
        ctx.fill();
      });
      frame = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("resize", setSize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", setSize); };
  }, []);
  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0, opacity: 0.7 }} />;
}

function StatusPill({ type, text }) {
  const cfg = {
    error: { bg: "#7f1d1d", border: "#ef4444", color: "#fca5a5", icon: "⚠" },
    success: { bg: "#14532d", border: "#22c55e", color: "#86efac", icon: "✓" },
    info: { bg: "#1c1917", border: "#f59e0b", color: "#fcd34d", icon: "◈" },
  };
  const s = cfg[type] || cfg.info;
  return (
    <div style={{ padding: "10px 16px", background: s.bg + "55", border: `1px solid ${s.border}60`, borderRadius: 8, fontFamily: "Inter, sans-serif", fontSize: 13, color: s.color, letterSpacing: 0.3, lineHeight: 1.5, marginTop: 14 }}>
      <span role={type === "error" ? "alert" : "status"}>{s.icon} {text}</span>
    </div>
  );
}

export default function Login({ onAuthSuccess }) {
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const [step, setStep] = useState("choose");
  const [method, setMethod] = useState(null);
  const [input, setInput] = useState("");
  const [resolvedEmail, setResolvedEmail] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [resendTimer, setResendTimer] = useState(0);
  const [hoveredCard, setHoveredCard] = useState(null);
  const identifier = method === "phone" ? { phone: input } : { email: input.trim() };

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setInterval(() => setResendTimer(p => p - 1), 1000);
    return () => clearInterval(t);
  }, [resendTimer]);

  // Surface a failure handed back by /auth/callback.
  useEffect(() => {
    const err = searchParams.get("error");
    if (!err) return;
    if (err === "unregistered") { setStep("error-unregistered"); return; }
    setStatus({ type: "error", text: ERROR_MESSAGES[err] || "Sign-in failed. Please try again." });
  }, [searchParams]);

  const requestCode = async (isResend = false) => {
    setLoading(true);
    if (!isResend) setStatus(null);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...identifier, returnTo }),
      });
      const data = await res.json();
      if (res.status === 429) throw new Error(data.error);
      if (!res.ok) throw new Error(data.error || "Failed to send login email");
      if (!data.registered) { setStep("error-unregistered"); setLoading(false); return; }

      setResolvedEmail(data.email);
      setCode("");
      setStep("magic-link-sent");
      setResendTimer(30);
      if (isResend) setStatus({ type: "success", text: "A new code is on its way." });
    } catch (err) {
      setStatus({ type: "error", text: err.message || "Failed to send login email" });
    }
    setLoading(false);
  };

  const handleCodeSubmit = async () => {
    if (code.length !== CODE_LENGTH || verifying) return;
    setVerifying(true); setStatus(null);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...identifier, code, returnTo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      onAuthSuccess?.(returnTo);
    } catch (err) {
      setStatus({ type: "error", text: err.message || "Verification failed" });
      setCode("");
      setVerifying(false);
    }
  };

  const reset = () => { setStep("choose"); setMethod(null); setInput(""); setStatus(null); setResolvedEmail(""); setCode(""); setVerifying(false); };

  const isValid = method === "phone" ? /^\d{10}$/.test(input) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@400;600;700;800;900&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse { 0%,100%{opacity:0.6} 50%{opacity:1} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes dotPulse { 0%,80%,100%{transform:scale(0);opacity:0} 40%{transform:scale(1);opacity:1} }
        input:focus { border-color:#f59e0b !important; box-shadow:0 0 0 3px rgba(245,158,11,0.15) !important; outline:none; }
        input::placeholder { color:#52525b; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-thumb { background:#3f3f46; border-radius:2px; }
        .method-card { width:100%; text-align:left; font:inherit; text-decoration:none; cursor:pointer; padding:18px 20px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; transition:all 0.25s ease; display:flex; align-items:center; gap:16px; }
        .method-card:hover { border-color:rgba(245,158,11,0.5); background:rgba(245,158,11,0.05); box-shadow:0 0 24px rgba(245,158,11,0.08); }
        .method-card:focus-visible, .amber-btn:focus-visible, .ghost-btn:focus-visible { outline:2px solid #f59e0b; outline-offset:4px; }
        .method-card.active { border-color:rgba(245,158,11,0.7); background:rgba(245,158,11,0.08); }
        .amber-btn { width:100%; padding:13px; background:linear-gradient(135deg,#f59e0b,#d97706); border:none; border-radius:10px; color:#0a0a0e; font-family:Inter,sans-serif; font-size:14px; font-weight:700; letter-spacing:0.5px; cursor:pointer; transition:all 0.25s ease; box-shadow:0 4px 20px rgba(245,158,11,0.3); }
        .amber-btn:hover { background:linear-gradient(135deg,#fbbf24,#f59e0b); box-shadow:0 6px 28px rgba(245,158,11,0.45); transform:translateY(-1px); }
        .amber-btn:disabled { background:#3f3f46; color:#71717a; cursor:not-allowed; box-shadow:none; transform:none; }
        .ghost-btn { background:none; border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#a1a1aa; padding:7px 14px; font-size:12px; cursor:pointer; letter-spacing:0.5px; font-family:Inter,sans-serif; transition:all 0.2s ease; }
        .ghost-btn:hover { border-color:rgba(245,158,11,0.4); color:#f59e0b; }
        .cyber-input { width:100%; padding:13px 16px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:10px; color:#f4f4f5; font-family:Inter,sans-serif; font-size:14px; outline:none; transition:all 0.2s; caret-color:#f59e0b; }
        .code-input { width:100%; padding:15px 16px; background:rgba(245,158,11,0.04); border:1px solid rgba(245,158,11,0.25); border-radius:10px; color:#f59e0b; font-family:'Courier New',monospace; font-size:24px; font-weight:700; letter-spacing:12px; text-align:center; outline:none; transition:all 0.2s; caret-color:#f59e0b; }
        .code-input::placeholder { color:#3f3f46; letter-spacing:12px; }
      `}</style>

      <ParticleBackground />

      {/* Radial glow */}
      <div style={{ position: "fixed", top: "30%", left: "50%", transform: "translate(-50%,-50%)", width: 600, height: 600, background: "radial-gradient(circle,rgba(245,158,11,0.06) 0%,transparent 70%)", pointerEvents: "none", zIndex: 1 }} />

      {/* Card */}
      <div style={{ position: "relative", zIndex: 10, width: "100%", maxWidth: 440, margin: "24px", animation: "fadeUp 0.6s ease forwards" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <img src="/logo.png" alt="AI Community Lucknow" style={{ height: 40, objectFit: "contain" }} />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 15, fontWeight: 800, color: "#f4f4f5", letterSpacing: 0.5, lineHeight: 1.2 }}>AI Community</div>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 15, fontWeight: 800, color: "#f59e0b", letterSpacing: 0.5, lineHeight: 1.2 }}>Lucknow</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#52525b", letterSpacing: 3, textTransform: "uppercase" }}>Mr. Bridge · Access Portal</div>
        </div>

        {/* Panel */}
        <div style={{ background: "rgba(18,18,22,0.92)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: "36px 32px", backdropFilter: "blur(24px)", boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.04)" }}>

          {/* ── CHOOSE METHOD ── */}
          {step === "choose" && (
            <>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 22, fontWeight: 800, color: "#f4f4f5", marginBottom: 4 }}>Welcome back</div>
              <div style={{ fontSize: 13, color: "#71717a", marginBottom: 28 }}>Invited to an event? Verify your account to get started.</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <button
                  type="button"
                  className={`method-card ${hoveredCard === "phone" ? "active" : ""}`}
                  onMouseEnter={() => setHoveredCard("phone")}
                  onMouseLeave={() => setHoveredCard(null)}
                  onClick={() => { setMethod("phone"); setStep("phone-input"); }}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📱</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f4f4f5", marginBottom: 3 }}>Phone Number</div>
                    <div style={{ fontSize: 12, color: "#71717a" }}>Get a code at your registered email</div>
                  </div>
                  <div style={{ marginLeft: "auto", color: "#52525b", fontSize: 18 }}>›</div>
                </button>

                <button
                  type="button"
                  className={`method-card ${hoveredCard === "email" ? "active" : ""}`}
                  onMouseEnter={() => setHoveredCard("email")}
                  onMouseLeave={() => setHoveredCard(null)}
                  onClick={() => { setMethod("email"); setStep("phone-input"); }}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>✉️</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f4f4f5", marginBottom: 3 }}>Email Address</div>
                    <div style={{ fontSize: 12, color: "#71717a" }}>Get a sign-in code and stay on this website</div>
                  </div>
                  <div style={{ marginLeft: "auto", color: "#52525b", fontSize: 18 }}>›</div>
                </button>

                <a className="method-card" href={`/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.36Z" />
                      <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.61 0-4.82-1.76-5.61-4.13H3.05v2.59A10 10 0 0 0 12 22Z" />
                      <path fill="#FBBC05" d="M6.39 13.92A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.92V7.49H3.05A10 10 0 0 0 2 12c0 1.61.38 3.14 1.05 4.51l3.34-2.59Z" />
                      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.34 2.59C7.18 7.71 9.39 5.95 12 5.95Z" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f4f4f5", marginBottom: 3 }}>Sign in with Google</div>
                    <div style={{ fontSize: 12, color: "#71717a" }}>Choose the Google account on your invitation</div>
                  </div>
                  <div style={{ marginLeft: "auto", color: "#52525b", fontSize: 18 }} aria-hidden="true">›</div>
                </a>
              </div>

              {status && <StatusPill type={status.type} text={status.text} />}

              <div style={{ marginTop: 24, padding: "12px 16px", background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10 }}>
                <div style={{ fontSize: 12, color: "#a16207", lineHeight: 1.7 }}>
                  ◈ Access is restricted to pre-registered attendees.<br />
                  Contact the event organiser if you haven't registered.
                </div>
              </div>
            </>
          )}

          {/* ── INPUT ── */}
          {step === "phone-input" && (
            <>
              <button className="ghost-btn" onClick={reset} style={{ marginBottom: 24 }}>← Back</button>

              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 20, fontWeight: 800, color: "#f4f4f5", marginBottom: 4 }}>
                {method === "phone" ? "Enter your phone" : "Enter your email"}
              </div>
              <div style={{ fontSize: 13, color: "#71717a", marginBottom: 24, lineHeight: 1.6 }}>
                {method === "phone"
                  ? "We'll send a code to your registered email. Enter it here to sign in."
                  : "We'll send a code to your invited email. Enter it here to sign in."}
              </div>

              {method === "phone" ? (
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#f59e0b", fontSize: 14, fontWeight: 600, pointerEvents: "none" }}>+91</div>
                  <input
                    className="cyber-input"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    aria-label="Registered phone number without the +91 country code"
                    value={input}
                    onChange={e => setInput(e.target.value.replace(/\D/g, ""))}
                    placeholder="9876543210"
                    maxLength={10}
                    onKeyDown={e => e.key === "Enter" && isValid && !loading && requestCode(false)}
                    style={{ paddingLeft: 52 }}
                  />
                </div>
              ) : (
                <input
                  className="cyber-input"
                  type="email"
                  autoComplete="email"
                  aria-label="Invited email address"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="you@example.com"
                  onKeyDown={e => e.key === "Enter" && isValid && !loading && requestCode(false)}
                />
              )}

              {status && <StatusPill type={status.type} text={status.text} />}

              <button
                className="amber-btn"
                style={{ marginTop: 20 }}
                onClick={() => requestCode(false)}
                disabled={loading || !isValid}
              >
                {loading ? "Sending..." : "Send sign-in code"}
              </button>
            </>
          )}

          {/* ── CODE SENT ── magic link + typed code, same challenge ── */}
          {step === "magic-link-sent" && (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <button className="ghost-btn" onClick={() => setStep("phone-input")} style={{ marginBottom: 24, display: "block" }}>← Back</button>

              <div style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 20px", animation: "pulse 2s ease infinite" }}>
                📧
              </div>

              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 20, fontWeight: 800, color: "#f4f4f5", marginBottom: 8 }}>Check your inbox</div>
              <div style={{ fontSize: 13, color: "#71717a", lineHeight: 1.8, marginBottom: 24 }}>
                A login code has been sent to<br />
                <span style={{ color: "#f59e0b", fontWeight: 600 }}>{resolvedEmail}</span>
              </div>

              <input
                className="code-input"
                aria-label="Six-digit email verification code"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
                placeholder="······"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={CODE_LENGTH}
                autoFocus
                onKeyDown={e => e.key === "Enter" && code.length === CODE_LENGTH && handleCodeSubmit()}
              />

              {status && <StatusPill type={status.type} text={status.text} />}

              <button
                className="amber-btn"
                style={{ marginTop: 16 }}
                onClick={handleCodeSubmit}
                disabled={verifying || code.length !== CODE_LENGTH}
              >
                {verifying ? "Verifying..." : "Verify & Sign In"}
              </button>

              <div style={{ padding: "16px 18px", background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 12, margin: "20px 0", textAlign: "left" }}>
                <div style={{ fontSize: 11, color: "#78350f", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>How to sign in</div>
                <div style={{ fontSize: 13, color: "#d97706", lineHeight: 1.9 }}>
                  1. Open your email app<br />
                  2. Find the email from <strong>Mr. Bridge</strong><br />
                  3. Type the <strong style={{ color: "#f59e0b" }}>6-digit code</strong> above, or click the <strong style={{ color: "#f59e0b" }}>"Log In"</strong> button inside<br />
                  <span style={{ color: "#71717a", fontSize: 12 }}>Either one signs you in.</span>
                </div>
              </div>

              <div style={{ fontSize: 12, color: "#52525b" }}>
                {resendTimer > 0 ? (
                  <span>Resend available in {resendTimer}s</span>
                ) : (
                  <button
                    onClick={() => requestCode(true)}
                    disabled={loading}
                    style={{ background: "none", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6, color: "#f59e0b", fontSize: 12, cursor: "pointer", padding: "7px 18px", fontFamily: "Inter,sans-serif", transition: "all 0.2s" }}
                  >
                    ↺ Resend Login Email
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── NOT REGISTERED ── */}
          {step === "error-unregistered" && (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ width: 64, height: 64, borderRadius: 18, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px" }}>⛔</div>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 18, fontWeight: 800, color: "#ef4444", marginBottom: 12 }}>Not Registered</div>
              <div style={{ fontSize: 13, color: "#71717a", lineHeight: 1.8, marginBottom: 24 }}>
                {input ? <><strong style={{ color: "#fca5a5" }}>{input}</strong> is not on the attendee list.</> : "This account is not on the attendee list for this event."}<br />
                Please contact the event organiser to get added.
              </div>
              <button className="amber-btn" onClick={reset}>← Try Again</button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 24, fontSize: 11, color: "#3f3f46", letterSpacing: 2 }}>
          AI COMMUNITY LUCKNOW · MR. BRIDGE
        </div>
      </div>
    </div>
  );
}
