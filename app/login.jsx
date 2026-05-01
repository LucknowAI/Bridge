"use client";

/**
 * Login.jsx — AI Community Lucknow · Mr. Bridge
 * Premium dark theme matching the AI Community Lucknow brand.
 * Amber/orange accent palette, Inter typography, glassmorphism cards.
 */

import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

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
      {s.icon} {text}
    </div>
  );
}

export default function Login({ onAuthSuccess }) {
  const [step, setStep] = useState("choose");
  const [method, setMethod] = useState(null);
  const [input, setInput] = useState("");
  const [resolvedEmail, setResolvedEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [resendTimer, setResendTimer] = useState(0);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [btnHover, setBtnHover] = useState(false);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setInterval(() => setResendTimer(p => p - 1), 1000);
    return () => clearInterval(t);
  }, [resendTimer]);

  useEffect(() => {
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session) {
        onAuthSuccess?.(session.user);
      }
    });
  }, []);

  const handlePhoneSubmit = async () => {
    setLoading(true); setStatus(null);
    try {
      const res = await fetch("/api/lookup-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: input }),
      });
      const data = await res.json();
      if (!data.registered) { setStep("error-unregistered"); setLoading(false); return; }
      const { error } = await supabase.auth.signInWithOtp({
        email: data.email,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setResolvedEmail(data.email);
      setStep("magic-link-sent");
      setResendTimer(30);
    } catch (err) {
      setStatus({ type: "error", text: err.message || "Failed to send login email" });
    }
    setLoading(false);
  };

  const checkEmailRegistered = async (email) => {
    const { data, error } = await supabase
      .from("registered_attendees")
      .select("id")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();
    if (error) throw new Error("Registry lookup failed");
    return !!data;
  };

  const handleEmailSubmit = async () => {
    setLoading(true); setStatus(null);
    try {
      const registered = await checkEmailRegistered(input);
      if (!registered) { setStep("error-unregistered"); setLoading(false); return; }
      sessionStorage.setItem("pending_email", input.toLowerCase().trim());
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { login_hint: input.trim() },
        },
      });
      if (error) throw error;
      setStep("email-pending");
    } catch (err) {
      setStatus({ type: "error", text: err.message || "Google sign-in failed" });
    }
    setLoading(false);
  };

  const reset = () => { setStep("choose"); setMethod(null); setInput(""); setStatus(null); setResolvedEmail(""); };

  const isValid = method === "phone" ? input.length === 10 : input.length > 4;

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
        .method-card { cursor:pointer; padding:18px 20px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; transition:all 0.25s ease; display:flex; align-items:center; gap:16px; }
        .method-card:hover { border-color:rgba(245,158,11,0.5); background:rgba(245,158,11,0.05); box-shadow:0 0 24px rgba(245,158,11,0.08); }
        .method-card.active { border-color:rgba(245,158,11,0.7); background:rgba(245,158,11,0.08); }
        .amber-btn { width:100%; padding:13px; background:linear-gradient(135deg,#f59e0b,#d97706); border:none; border-radius:10px; color:#0a0a0e; font-family:Inter,sans-serif; font-size:14px; font-weight:700; letter-spacing:0.5px; cursor:pointer; transition:all 0.25s ease; box-shadow:0 4px 20px rgba(245,158,11,0.3); }
        .amber-btn:hover { background:linear-gradient(135deg,#fbbf24,#f59e0b); box-shadow:0 6px 28px rgba(245,158,11,0.45); transform:translateY(-1px); }
        .amber-btn:disabled { background:#3f3f46; color:#71717a; cursor:not-allowed; box-shadow:none; transform:none; }
        .ghost-btn { background:none; border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#a1a1aa; padding:7px 14px; font-size:12px; cursor:pointer; letter-spacing:0.5px; font-family:Inter,sans-serif; transition:all 0.2s ease; }
        .ghost-btn:hover { border-color:rgba(245,158,11,0.4); color:#f59e0b; }
        .cyber-input { width:100%; padding:13px 16px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:10px; color:#f4f4f5; font-family:Inter,sans-serif; font-size:14px; outline:none; transition:all 0.2s; caret-color:#f59e0b; }
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
              <div style={{ fontSize: 13, color: "#71717a", marginBottom: 28 }}>Sign in to access the attendee matching system</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div
                  className={`method-card ${hoveredCard === "phone" ? "active" : ""}`}
                  onMouseEnter={() => setHoveredCard("phone")}
                  onMouseLeave={() => setHoveredCard(null)}
                  onClick={() => { setMethod("phone"); setStep("phone-input"); }}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📱</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f4f4f5", marginBottom: 3 }}>Phone Number</div>
                    <div style={{ fontSize: 12, color: "#71717a" }}>We'll send a magic link to your registered email</div>
                  </div>
                  <div style={{ marginLeft: "auto", color: "#52525b", fontSize: 18 }}>›</div>
                </div>

                <div
                  className={`method-card ${hoveredCard === "email" ? "active" : ""}`}
                  onMouseEnter={() => setHoveredCard("email")}
                  onMouseLeave={() => setHoveredCard(null)}
                  onClick={() => { setMethod("email"); setStep("phone-input"); }}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>✉️</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f4f4f5", marginBottom: 3 }}>Email Address</div>
                    <div style={{ fontSize: 12, color: "#71717a" }}>Continue with Google OAuth</div>
                  </div>
                  <div style={{ marginLeft: "auto", color: "#52525b", fontSize: 18 }}>›</div>
                </div>
              </div>

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
                  ? "We'll look up your registered email and send you a magic link."
                  : "We'll verify you're registered, then redirect to Google."}
              </div>

              {method === "phone" ? (
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#f59e0b", fontSize: 14, fontWeight: 600, pointerEvents: "none" }}>+91</div>
                  <input
                    className="cyber-input"
                    value={input}
                    onChange={e => setInput(e.target.value.replace(/\D/g, ""))}
                    placeholder="9876543210"
                    maxLength={10}
                    onKeyDown={e => e.key === "Enter" && handlePhoneSubmit()}
                    style={{ paddingLeft: 52 }}
                  />
                </div>
              ) : (
                <input
                  className="cyber-input"
                  type="email"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="you@example.com"
                  onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
                />
              )}

              {status && <StatusPill type={status.type} text={status.text} />}

              <button
                className="amber-btn"
                style={{ marginTop: 20 }}
                onClick={method === "phone" ? handlePhoneSubmit : handleEmailSubmit}
                disabled={loading || !isValid}
              >
                {loading ? "Verifying..." : method === "phone" ? "Send Magic Link" : "Continue with Google"}
              </button>
            </>
          )}

          {/* ── MAGIC LINK SENT ── */}
          {step === "magic-link-sent" && (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <button className="ghost-btn" onClick={() => setStep("phone-input")} style={{ marginBottom: 24, display: "block" }}>← Back</button>

              <div style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 20px", animation: "pulse 2s ease infinite" }}>
                📧
              </div>

              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 20, fontWeight: 800, color: "#f4f4f5", marginBottom: 8 }}>Check your inbox</div>
              <div style={{ fontSize: 13, color: "#71717a", lineHeight: 1.8, marginBottom: 24 }}>
                A login link has been sent to<br />
                <span style={{ color: "#f59e0b", fontWeight: 600 }}>{resolvedEmail}</span>
              </div>

              <div style={{ padding: "16px 18px", background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 12, marginBottom: 20, textAlign: "left" }}>
                <div style={{ fontSize: 11, color: "#78350f", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>How to sign in</div>
                <div style={{ fontSize: 13, color: "#d97706", lineHeight: 1.9 }}>
                  1. Open your email app<br />
                  2. Find the email from <strong>Build with AI</strong><br />
                  3. Click the <strong style={{ color: "#f59e0b" }}>"Log In"</strong> button inside<br />
                  <span style={{ color: "#71717a", fontSize: 12 }}>You'll be signed in automatically.</span>
                </div>
              </div>

              <div style={{ fontSize: 12, color: "#52525b" }}>
                {resendTimer > 0 ? (
                  <span>Resend available in {resendTimer}s</span>
                ) : (
                  <button
                    onClick={() => { setResendTimer(30); handlePhoneSubmit(); }}
                    style={{ background: "none", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6, color: "#f59e0b", fontSize: 12, cursor: "pointer", padding: "7px 18px", fontFamily: "Inter,sans-serif", transition: "all 0.2s" }}
                  >
                    ↺ Resend Login Email
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── EMAIL PENDING ── */}
          {step === "email-pending" && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ width: 64, height: 64, borderRadius: 18, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px", animation: "pulse 1.5s ease infinite" }}>↗</div>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 20, fontWeight: 800, color: "#f59e0b", marginBottom: 8 }}>Redirecting to Google…</div>
              <div style={{ fontSize: 13, color: "#71717a", lineHeight: 1.7 }}>
                Taking you to Google sign-in.<br />
                <span style={{ color: "#a16207" }}>Only your registered email will be accepted.</span>
              </div>
            </div>
          )}

          {/* ── NOT REGISTERED ── */}
          {step === "error-unregistered" && (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ width: 64, height: 64, borderRadius: 18, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px" }}>⛔</div>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 18, fontWeight: 800, color: "#ef4444", marginBottom: 12 }}>Not Registered</div>
              <div style={{ fontSize: 13, color: "#71717a", lineHeight: 1.8, marginBottom: 24 }}>
                <strong style={{ color: "#fca5a5" }}>{input}</strong> is not on the attendee list.<br />
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