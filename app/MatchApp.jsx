"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const GLITCH_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?/~`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function glitchText(text, progress) {
  return text.split("").map((char) => {
    if (char === " ") return " ";
    if (Math.random() < progress) return char;
    return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
  }).join("");
}

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

function GlitchTitle({ text }) {
  const [displayed, setDisplayed] = useState(text);
  useEffect(() => {
    let progress = 0;
    const iv = setInterval(() => {
      progress = Math.min(1, progress + 0.05);
      setDisplayed(glitchText(text, progress));
      if (progress >= 1) { setDisplayed(text); clearInterval(iv); }
    }, 40);
    return () => clearInterval(iv);
  }, [text]);
  return <span>{displayed}</span>;
}

function MatchAnimation({ candidates, onComplete }) {
  const [phase, setPhase] = useState("scanning");
  const [scanIndex, setScanIndex] = useState(0);
  const [revealIndex, setRevealIndex] = useState(-1);
  const [progressVal, setProgressVal] = useState(0);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    let idx = 0;
    const scanIv = setInterval(() => {
      setScanIndex(idx);
      setProgressVal(Math.round((idx / candidates.length) * 70));
      idx++;
      if (idx >= candidates.length) {
        clearInterval(scanIv);
        setTimeout(() => {
          setPhase("revealing");
          setProgressVal(100);
          let ri = -1;
          const revIv = setInterval(() => {
            ri++;
            setRevealIndex(ri);
            if (ri >= candidates.length - 1) {
              clearInterval(revIv);
              setTimeout(() => onCompleteRef.current(candidates), 1000);
            }
          }, 160);
        }, 600);
      }
    }, 80);
    return () => clearInterval(scanIv);
  }, [candidates]);


  return (
    <div style={{ position: "relative", zIndex: 10 }}>
      <style>{`
        @keyframes scanPulse { 0%,100%{box-shadow:0 0 8px #f59e0b,0 0 20px rgba(245,158,11,0.25)} 50%{box-shadow:0 0 20px #f59e0b,0 0 50px rgba(245,158,11,0.5)} }
        @keyframes slideIn { from{transform:translateX(-30px);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes rankGlow { 0%,100%{text-shadow:0 0 8px #f59e0b} 50%{text-shadow:0 0 25px #f59e0b,0 0 50px rgba(245,158,11,0.4)} }
        @keyframes topReveal { 0%{transform:scale(0.8) translateY(20px);opacity:0;filter:blur(10px)} 100%{transform:scale(1) translateY(0);opacity:1;filter:blur(0)} }
        @keyframes barFill { from{width:0} to{width:var(--w)} }
      `}</style>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontFamily: "Inter, sans-serif", color: "#f59e0b", fontSize: 13, letterSpacing: 4, marginBottom: 12 }}>
          {phase === "scanning" ? "◈ AI MATCHING CANDIDATES" : "◈ TOP 10 MATCHES RANKED BY EXPERIENCE"}
        </div>
        <div style={{ width: "100%", maxWidth: 500, margin: "0 auto", height: 4, background: "rgba(255,255,255,0.04)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", background: "linear-gradient(90deg,#f59e0b,#d97706)", width: `${progressVal}%`, transition: "width 0.3s ease", boxShadow: "0 0 10px #f59e0b" }} />
        </div>
        <div style={{ fontFamily: "Inter, sans-serif", color: "rgba(245,158,11,0.6)", fontSize: 11, marginTop: 8 }}>{progressVal}% ANALYZED</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 480, overflowY: "auto", paddingRight: 4 }}>
        {candidates.map((c, i) => {
          const isScanning = phase === "scanning" && i === scanIndex;
          const isRevealed = phase === "revealing" && i <= revealIndex;
          const isTop = i === 0 && isRevealed;
          return (
            <div key={c.id || i} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
              background: isTop ? "linear-gradient(135deg,rgba(245,158,11,0.1),rgba(217,119,6,0.05))" : isScanning ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${isTop ? "#f59e0b" : isScanning ? "rgba(245,158,11,0.5)" : "rgba(245,158,11,0.15)"}`,
              borderRadius: 12, transition: "all 0.3s ease",
              animation: isScanning ? "scanPulse 0.5s ease infinite" : isTop ? "topReveal 0.6s ease forwards" : isRevealed ? "slideIn 0.3s ease forwards" : "none",
              opacity: phase === "revealing" && !isRevealed ? 0.2 : 1,
            }}>
              <div style={{ fontFamily: "Outfit, sans-serif", color: "#f59e0b", fontSize: 13, width: 22, textAlign: "center", animation: isTop ? "rankGlow 2s ease infinite" : "none", fontWeight: 700 }}>
                {phase === "revealing" && isRevealed ? (i === 0 ? "★" : `#${i + 1}`) : "·"}
              </div>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,rgba(245,158,11,0.2),rgba(217,119,6,0.15))", border: `1px solid ${isTop ? "#f59e0b" : "rgba(245,158,11,0.3)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", color: "#f59e0b", fontSize: 14, flexShrink: 0 }}>
                {c.avatar}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "Inter, sans-serif", color: isTop ? "#f59e0b" : "#f4f4f5", fontSize: 14, fontWeight: isTop ? 700 : 500 }}>{c.name}</div>
                <div style={{ color: "rgba(245,158,11,0.6)", fontSize: 12, marginTop: 2 }}>{c.designation || c.domain}</div>
              </div>
              {isRevealed && (
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "Inter, sans-serif", color: isTop ? "#f59e0b" : "#d97706", fontSize: 15, fontWeight: 700 }}>{c.score}%</div>
                  <div style={{ fontFamily: "Inter, sans-serif", color: "rgba(245,158,11,0.4)", fontSize: 10 }}>{c.years_of_experience != null ? `${c.years_of_experience}y exp` : ""}</div>
                  <div style={{ width: 70, height: 3, background: "rgba(255,255,255,0.04)", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                    <div style={{ "--w": `${c.score}%`, height: "100%", background: isTop ? "linear-gradient(90deg,#f59e0b,#d97706)" : "rgba(217,119,6,0.5)", animation: "barFill 0.6s ease forwards" }} />
                  </div>
                </div>
              )}
              {isScanning && <div style={{ fontFamily: "Inter, sans-serif", color: "#f59e0b", fontSize: 10, animation: "rankGlow 0.5s ease infinite", fontWeight: 600 }}>SCANNING...</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProfileModal({ person, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(10,10,14,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(8px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: "rgba(18,18,22,0.95)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 20, padding: "32px 28px", position: "relative", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(245,158,11,0.05)" }}>
        <style>{`@keyframes modalIn { from{opacity:0;transform:scale(0.93) translateY(16px)} to{opacity:1;transform:scale(1) translateY(0)} }`}</style>
        <div style={{ animation: "modalIn 0.3s ease forwards" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6, color: "rgba(245,158,11,0.6)", padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "Inter, sans-serif", transition: "all 0.2s ease" }}>✕ ESC</button>

          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg,rgba(245,158,11,0.15),rgba(217,119,6,0.1))", border: "2px solid #f59e0b", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", fontSize: 26, color: "#f59e0b", fontWeight: 700, margin: "0 auto 14px", boxShadow: "0 0 24px rgba(245,158,11,0.2)" }}>
              {person.avatar}
            </div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 20, fontWeight: 800, color: "#f4f4f5", letterSpacing: 0.5, marginBottom: 4 }}>{person.name}</div>
            <div style={{ color: "#f59e0b", fontFamily: "Inter, sans-serif", fontSize: 13, marginBottom: 2, fontWeight: 500 }}>{person.designation || "—"}</div>
            <div style={{ color: "rgba(244,244,245,0.6)", fontFamily: "Inter, sans-serif", fontSize: 12 }}>{person.domain || "—"}</div>
          </div>

          <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
            <div style={{ flex: 1, padding: "14px", background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 12, textAlign: "center" }}>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: 22, fontWeight: 800, color: "#f59e0b" }}>{person.years_of_experience != null ? `${person.years_of_experience}y` : "N/A"}</div>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: 10, color: "rgba(245,158,11,0.6)", letterSpacing: 1, marginTop: 4, fontWeight: 500 }}>EXPERIENCE</div>
            </div>
            <div style={{ flex: 1, padding: "14px", background: "rgba(217,119,6,0.05)", border: "1px solid rgba(217,119,6,0.15)", borderRadius: 12, textAlign: "center" }}>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: 22, fontWeight: 800, color: "#d97706" }}>{person.score}%</div>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: 10, color: "rgba(217,119,6,0.6)", letterSpacing: 1, marginTop: 4, fontWeight: 500 }}>COMPATIBILITY</div>
            </div>
          </div>

          {person.match_reason && (
            <div style={{ padding: "16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, marginBottom: 12 }}>
              <div style={{ fontFamily: "Inter, sans-serif", color: "rgba(245,158,11,0.6)", fontSize: 10, letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>◈ WHY YOU MATCH</div>
              <div style={{ color: "#f4f4f5", fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.6 }}>{person.match_reason}</div>
            </div>
          )}

          {person.about_me && (
            <div style={{ padding: "16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, marginBottom: 12 }}>
              <div style={{ fontFamily: "Inter, sans-serif", color: "rgba(245,158,11,0.6)", fontSize: 10, letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>◈ ABOUT</div>
              <div style={{ color: "#f4f4f5", fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.6 }}>{person.about_me}</div>
            </div>
          )}

          {person.most_impressive_build && (
            <div style={{ padding: "16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, marginBottom: 12 }}>
              <div style={{ fontFamily: "Inter, sans-serif", color: "rgba(245,158,11,0.6)", fontSize: 10, letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>◈ MOST IMPRESSIVE AI BUILD</div>
              <div style={{ color: "#f4f4f5", fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.6 }}>{person.most_impressive_build}</div>
            </div>
          )}

          <div style={{ padding: "16px", background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 12 }}>
            <div style={{ fontFamily: "Inter, sans-serif", color: "#d97706", fontSize: 10, letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>◈ ICEBREAKER</div>
            <div style={{ color: "#f59e0b", fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.6, fontStyle: "italic" }}>
              &quot;Hey {person.name?.split(" ")[0]}, I&apos;d love to connect about {person.domain} — got 10 mins?&quot;
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchList({ candidates, onSelectProfile, onRematch, onReset }) {
  return (
    <div style={{ position: "relative", zIndex: 10 }}>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .match-row { cursor:pointer; transition:all 0.2s ease; }
        .match-row:hover { border-color:rgba(245,158,11,0.5) !important; background:rgba(245,158,11,0.08) !important; transform:translateX(4px); }
      `}</style>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 800, color: "#f4f4f5", marginBottom: 6 }}>YOUR TOP 10 MATCHES</div>
        <div style={{ fontFamily: "Inter, sans-serif", color: "rgba(245,158,11,0.6)", fontSize: 11, letterSpacing: 1, fontWeight: 500 }}>RANKED BY EXPERIENCE · CLICK ANY PROFILE TO EXPLORE</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {candidates.map((c, i) => (
          <div key={c.id || i} className="match-row" onClick={() => onSelectProfile(c)}
            style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: i === 0 ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${i === 0 ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.08)"}`, borderRadius: 12, animation: `fadeUp 0.4s ease ${i * 0.05}s both` }}>
            <div style={{ fontFamily: "Outfit, sans-serif", color: i === 0 ? "#f59e0b" : "#71717a", fontSize: i === 0 ? 15 : 13, fontWeight: 800, width: 28, textAlign: "center", flexShrink: 0 }}>
              {i === 0 ? "★" : `#${i + 1}`}
            </div>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(135deg,rgba(245,158,11,0.15),rgba(217,119,6,0.1))", border: `1px solid ${i === 0 ? "#f59e0b" : "rgba(245,158,11,0.2)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", color: "#f59e0b", fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
              {c.avatar}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "Inter, sans-serif", color: "#f4f4f5", fontSize: 14, fontWeight: i === 0 ? 700 : 500, marginBottom: 2 }}>{c.name}</div>
              <div style={{ color: "rgba(244,244,245,0.6)", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.designation || c.domain}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: "Inter, sans-serif", color: i === 0 ? "#f59e0b" : "#d97706", fontSize: 16, fontWeight: 700 }}>{c.score}%</div>
              <div style={{ fontFamily: "Inter, sans-serif", color: "rgba(245,158,11,0.5)", fontSize: 11, marginTop: 2 }}>{c.years_of_experience != null ? `${c.years_of_experience}y exp` : ""}</div>
            </div>
            <div style={{ color: "rgba(245,158,11,0.3)", fontSize: 16, flexShrink: 0, marginLeft: 6 }}>›</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onRematch} style={{ flex: 1, padding: "14px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#a1a1aa", fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 1, cursor: "pointer", transition: "all 0.2s" }} onMouseEnter={e => { e.target.style.borderColor = "rgba(245,158,11,0.4)"; e.target.style.color = "#f59e0b"; }} onMouseLeave={e => { e.target.style.borderColor = "rgba(255,255,255,0.1)"; e.target.style.color = "#a1a1aa"; }}>↺ REMATCH</button>
        <button onClick={onReset} style={{ flex: 1, padding: "14px", background: "transparent", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, color: "#f59e0b", fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 1, cursor: "pointer", transition: "all 0.2s" }} onMouseEnter={e => { e.target.style.background = "rgba(245,158,11,0.05)"; e.target.style.borderColor = "#f59e0b"; }} onMouseLeave={e => { e.target.style.background = "transparent"; e.target.style.borderColor = "rgba(245,158,11,0.3)"; }}>◈ NEW PROFILE</button>
      </div>
    </div>
  );
}

export default function App() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [userProfile, setUserProfile] = useState(null);
  const [phase, setPhase] = useState("landing");
  const [userName, setUserName] = useState("");
  const [userDomain, setUserDomain] = useState("");
  const [userInterests, setUserInterests] = useState([]);
  const [allDomains, setAllDomains] = useState([]);
  const [allInterests] = useState([
    "React", "Vue.js", "Angular", "Next.js", "TypeScript", "JavaScript", "WebAssembly",
    "Node.js", "Python", "Go", "Rust", "Java", "C#", "C++", "PHP", "Ruby",
    "FastAPI", "Django", "Spring Boot", "GraphQL", "REST API", "gRPC",
    "Flutter", "React Native", "Swift", "Kotlin", "Android", "iOS",
    "Electron", "Tauri", "System Programming", "Compilers", "OS Development",
    "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "Generative AI",
    "LLMs", "RAG", "Fine-tuning", "Prompt Engineering", "LangChain", "LlamaIndex",
    "AI Agents", "Vector Databases", "Semantic Search",
    "TensorFlow", "PyTorch", "Scikit-learn", "XGBoost", "ONNX", "AutoML",
    "Diffusion Models", "Object Detection", "Medical Imaging", "3D Vision", "NeRF",
    "Reinforcement Learning", "RLHF", "Interpretability", "Alignment",
    "Data Science", "Data Engineering", "ETL", "Feature Engineering",
    "Apache Spark", "Kafka", "Airflow", "dbt", "SQL", "NoSQL", "Data Warehousing", "Big Data",
    "DevOps", "SRE", "Docker", "Kubernetes", "Terraform", "Ansible", "CI/CD", "GitOps",
    "AWS", "GCP", "Azure", "Serverless", "Microservices", "Cloud-Native",
    "MLOps", "LLMOps", "Platform Engineering",
    "Penetration Testing", "AppSec", "Network Security", "Cloud Security",
    "Cryptography", "OSINT", "OWASP", "CTF", "Malware Analysis", "SOC",
    "AI Security", "Adversarial ML", "Zero Trust", "Red Teaming",
    "Embedded Systems", "Firmware", "RTOS", "FPGA", "Embedded C", "Arduino",
    "IoT", "Edge AI", "ROS", "Drones", "Robotics", "Telecommunications", "RF Engineering",
    "Game Development", "Unity", "Unreal Engine", "OpenGL", "Vulkan", "WebGL",
    "AR/VR", "Spatial Computing", "Computer Graphics",
    "Blockchain", "Web3", "Smart Contracts", "Solidity", "DeFi", "dApps",
    "NFTs", "DAOs", "ZK Proofs", "Ethereum", "Layer 2",
    "Automation Testing", "Selenium", "Cypress", "Performance Testing", "Security Testing",
    "FinTech", "HealthTech", "EdTech", "E-commerce", "ERP", "Salesforce", "SAP",
    "UI/UX Design", "Figma", "Design Systems", "Accessibility",
    "Technical Product Management", "Developer Relations", "Technical Writing",
    "AI Products", "Growth Hacking",
  ]);
  const [candidates, setCandidates] = useState([]);
  const [topMatch, setTopMatch] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [matchError, setMatchError] = useState(null);
  const [hoverBtn, setHoverBtn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace("/login"); }
      else { setAuthUser(session.user); fetchUserProfile(session.user); }
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace("/login");
    });
    return () => subscription.unsubscribe();
  }, [router]);

  const fetchUserProfile = async (user) => {
    const identifier = user.email || user.phone;
    const field = user.email ? "email" : "phone";
    const { data } = await supabase.from("registered_attendees").select("*").eq(field, identifier).maybeSingle();
    if (data) {
      setUserProfile(data);
      if (data.name) setUserName(data.name);
      if (data.domain) setUserDomain(data.domain);
    }
  };

  useEffect(() => {
    if (!authUser) return;
    supabase.from("registered_attendees").select("domain").then(({ data }) => {
      if (!data) return;
      const domains = [...new Set(data.map(a => a.domain).filter(Boolean))].sort();
      setAllDomains(domains.length ? domains : [
        "Frontend Development", "Backend Development", "Full-Stack Development",
        "Mobile App Development", "Desktop Application Development",
        "API Development & Integration", "System Programming",
        "Machine Learning", "Deep Learning", "Natural Language Processing",
        "Computer Vision", "Generative AI & LLM Engineering", "Data Science",
        "Data Engineering & ETL", "Big Data Analytics", "Data Architecture",
        "DevOps Engineering", "Site Reliability Engineering",
        "Cloud Engineering", "Platform Engineering",
        "Database Administration", "Network Engineering", "System Administration",
        "Application Security", "Network Security", "Cloud Security",
        "Penetration Testing", "Incident Response & Digital Forensics",
        "Security Operations", "Cryptography", "Vulnerability Research",
        "Embedded Systems Engineering", "Firmware Development",
        "Internet of Things", "Robotics Software Engineering",
        "Automotive Software Engineering", "Telecommunications & RF",
        "Game Development", "Game Engine Development", "Computer Graphics",
        "AR/VR Development", "Spatial Computing",
        "Blockchain Development", "Smart Contract Engineering",
        "Web3 & Decentralized Apps",
        "Automation Testing", "Performance & Load Testing",
        "Security Testing", "Manual Testing",
        "FinTech", "HealthTech", "EdTech", "E-commerce Development", "ERP/CRM Development",
        "UI/UX Design", "Technical Product Management",
        "Developer Relations", "Technical Writing",
        "Web3 & Blockchain", "Cloud & DevOps", "Cybersecurity",
        "Product & Strategy", "Robotics & IoT", "AI Safety",
      ]);
    });
  }, [authUser]);

  const handleStartMatch = async () => {
    if (!userName || !userDomain || !userInterests.length) return;
    setMatchError(null);
    setCandidates([]);
    setPhase("matching");
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName, userDomain, userInterests, userProfile }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Match failed");
      setCandidates(data.matches);
    } catch (err) {
      setMatchError(err.message);
      setPhase("form");
    }
  };

  const toggleInterest = (interest) => {
    setUserInterests(prev => prev.includes(interest) ? prev.filter(i => i !== interest) : prev.length < 8 ? [...prev, interest] : prev);
  };

  const handleReset = () => {
    setPhase("landing"); setUserDomain(""); setUserInterests([]);
    setTopMatch(null); setCandidates([]); setMatchError(null); setSelectedProfile(null);
  };

  const canProceed = userName.trim() && userDomain && userInterests.length > 0;

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0e", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: "Inter, sans-serif", color: "#f59e0b", fontSize: 13, letterSpacing: 4 }}>◈ AUTHENTICATING...</div>
    </div>
  );

  if (!authUser) return null;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0e", color: "#f4f4f5", fontFamily: "Inter, sans-serif", position: "relative", overflow: "hidden" }}>
      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:6px; } ::-webkit-scrollbar-thumb { background:#3f3f46; border-radius:3px; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes orbPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.4);opacity:0.6} }
        .interest-chip { cursor:pointer; padding:8px 14px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; color:#a1a1aa; font-size:12px; font-weight:500; transition:all 0.2s ease; }
        .interest-chip:hover { border-color:rgba(245,158,11,0.4); color:#f59e0b; background:rgba(245,158,11,0.05); }
        .interest-chip.active { background:rgba(245,158,11,0.1); border-color:#f59e0b; color:#f59e0b; box-shadow:0 4px 12px rgba(245,158,11,0.2); }
        .domain-btn { cursor:pointer; padding:10px 14px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; color:#a1a1aa; font-size:13px; font-weight:500; transition:all 0.2s ease; text-align:center; }
        .domain-btn:hover { border-color:rgba(217,119,6,0.4); color:#d97706; background:rgba(217,119,6,0.05); }
        .domain-btn.active { background:rgba(217,119,6,0.1); border-color:#d97706; color:#d97706; box-shadow:0 4px 12px rgba(217,119,6,0.2); }
        .premium-input { width:100%; padding:14px 16px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:10px; color:#f4f4f5; font-family:Inter, sans-serif; font-size:15px; outline:none; transition:all 0.2s ease; caret-color:#f59e0b; }
        .premium-input:focus { border-color:#f59e0b; box-shadow:0 0 0 3px rgba(245,158,11,0.15); background:rgba(255,255,255,0.05); }
        .premium-input::placeholder { color:#52525b; }
        .amber-btn { width:100%; padding:16px; background:linear-gradient(135deg,#f59e0b,#d97706); border:none; border-radius:10px; color:#0a0a0e; font-family:Inter,sans-serif; font-size:14px; font-weight:700; letter-spacing:0.5px; cursor:pointer; transition:all 0.25s ease; box-shadow:0 4px 20px rgba(245,158,11,0.3); }
        .amber-btn:hover { background:linear-gradient(135deg,#fbbf24,#f59e0b); box-shadow:0 6px 28px rgba(245,158,11,0.45); transform:translateY(-1px); }
        .amber-btn:disabled { background:#27272a; color:#71717a; cursor:not-allowed; box-shadow:none; transform:none; }
      `}</style>

      <ParticleBackground />
      <div style={{ position: "fixed", top: "20%", left: "50%", transform: "translate(-50%,-50%)", width: 800, height: 800, background: "radial-gradient(circle,rgba(245,158,11,0.05) 0%,transparent 60%)", pointerEvents: "none", zIndex: 1 }} />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 32px", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(10,10,14,0.6)", backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src="/logo.png" alt="AI Community Logo" style={{ height: 36, objectFit: "contain" }} />
          <div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 900, color: "#f4f4f5", letterSpacing: 1 }}>AI COMMUNITY</div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 14, fontWeight: 900, color: "#f59e0b", letterSpacing: 1 }}>LUCKNOW</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: "#a1a1aa", fontWeight: 500 }}>{userProfile?.name || authUser.email || authUser.phone}</div>
          <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: "#f59e0b", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", boxShadow: "0 0 10px #f59e0b", animation: "orbPulse 1.5s ease infinite" }} />
            LIVE
          </div>
          <button onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}
            style={{ background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, color: "#ef4444", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Inter, sans-serif", transition: "all 0.2s" }} onMouseEnter={e => { e.target.style.background = "rgba(239,68,68,0.1)"; }} onMouseLeave={e => { e.target.style.background = "none"; }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ position: "relative", zIndex: 10, maxWidth: 760, margin: "0 auto", padding: "40px 24px 80px" }}>

        {/* LANDING */}
        {phase === "landing" && (
          <div style={{ animation: "fadeIn 0.8s ease forwards", textAlign: "center", marginTop: 20 }}>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 13, letterSpacing: 4, color: "#f59e0b", marginBottom: 24, fontWeight: 700 }}>◈ ATTENDEE MATCHMAKING ◈</div>
            <h1 style={{ fontFamily: "Outfit, sans-serif", fontSize: "clamp(36px,7vw,64px)", fontWeight: 900, lineHeight: 1.1, marginBottom: 24, color: "#f4f4f5", letterSpacing: -1 }}>
              FIND YOUR<br /><span style={{ color: "transparent", WebkitTextStroke: "1px #f59e0b", backgroundImage: "linear-gradient(135deg, #f59e0b, #fbbf24)", WebkitBackgroundClip: "text", textShadow: "0 10px 40px rgba(245,158,11,0.3)" }}>PERFECT</span><br />COLLABORATOR
            </h1>
            <p style={{ color: "#a1a1aa", fontSize: 16, lineHeight: 1.7, maxWidth: 520, margin: "0 auto 40px", fontWeight: 400 }}>
              Connect with fellow builders. Our AI analyzes everyone's profile, domain expertise, and experience to find your top 10 most compatible matches.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 40, marginBottom: 50 }}>
              {[["AI", "POWERED MATCHING"], ["Top 10", "BEST MATCHES"], ["Ranked", "BY EXPERIENCE"]].map(([val, label], i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 24, fontWeight: 800, color: "#f59e0b" }}>{val}</div>
                  <div style={{ fontSize: 11, color: "#71717a", letterSpacing: 1, marginTop: 6, fontWeight: 500, textTransform: "uppercase" }}>{label}</div>
                </div>
              ))}
            </div>
            {userProfile && (
              <div style={{ padding: "20px 24px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, marginBottom: 40, textAlign: "left", maxWidth: 440, margin: "0 auto 40px", backdropFilter: "blur(12px)" }}>
                <div style={{ fontFamily: "Inter, sans-serif", color: "#f59e0b", fontSize: 11, letterSpacing: 1, marginBottom: 12, fontWeight: 600 }}>◈ YOUR REGISTERED PROFILE</div>
                <div style={{ color: "#f4f4f5", fontSize: 14, lineHeight: 1.8, fontWeight: 500 }}>
                  {userProfile.name && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#71717a" }}>Name</span> <span>{userProfile.name}</span></div>}
                  {userProfile.designation && <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ color: "#71717a" }}>Role</span> <span>{userProfile.designation}</span></div>}
                  {userProfile.domain && <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ color: "#71717a" }}>Domain</span> <span style={{ color: "#f59e0b" }}>{userProfile.domain}</span></div>}
                  {userProfile.years_of_experience != null && <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ color: "#71717a" }}>Experience</span> <span>{userProfile.years_of_experience} years</span></div>}
                </div>
              </div>
            )}
            <button onClick={() => setPhase("form")} className="amber-btn" style={{ maxWidth: 320 }}>
              INITIALIZE MATCH
            </button>
          </div>
        )}

        {/* FORM */}
        {phase === "form" && (
          <div style={{ animation: "fadeIn 0.6s ease forwards", background: "rgba(18,18,22,0.6)", padding: "40px", borderRadius: "24px", border: "1px solid rgba(255,255,255,0.05)", backdropFilter: "blur(16px)", boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}>
            <div style={{ marginBottom: 36, display: "flex", alignItems: "center", gap: 20 }}>
              <button onClick={() => setPhase("landing")} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#a1a1aa", padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }} onMouseEnter={e => { e.target.style.background = "rgba(255,255,255,0.1)"; }} onMouseLeave={e => { e.target.style.background = "rgba(255,255,255,0.05)"; }}>← Back</button>
              <div>
                <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 24, fontWeight: 800, color: "#f4f4f5" }}>Match Profile</div>
                <div style={{ color: "#71717a", fontSize: 13, marginTop: 4 }}>Tell us what you're interested in</div>
              </div>
            </div>
            {matchError && (
              <div style={{ padding: "14px 18px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#fca5a5", fontSize: 13, fontWeight: 500, marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
                <span>⚠</span> {matchError}
              </div>
            )}
            <div style={{ marginBottom: 32 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#f4f4f5", marginBottom: 10 }}>YOUR NAME</label>
              <input className="premium-input" placeholder="Enter your name..." value={userName} onChange={e => setUserName(e.target.value)} />
            </div>
            <div style={{ marginBottom: 32 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#f4f4f5", marginBottom: 10 }}>PRIMARY DOMAIN <span style={{ color: "#71717a", fontWeight: 400, marginLeft: 6 }}>(Select one)</span></label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 }}>
                {allDomains.map(d => (
                  <button key={d} className={`domain-btn ${userDomain === d ? "active" : ""}`} onClick={() => setUserDomain(d)}>{d}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 40 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#f4f4f5", marginBottom: 10 }}>
                INTERESTS <span style={{ color: "#f59e0b", fontWeight: 600, marginLeft: 6 }}>{userInterests.length}/8 selected</span>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {allInterests.map(interest => (
                  <button key={interest} className={`interest-chip ${userInterests.includes(interest) ? "active" : ""}`} onClick={() => toggleInterest(interest)}>{interest}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              {[!!userName, !!userDomain, userInterests.length > 0].map((done, i) => (
                <div key={i} style={{ flex: 1, height: 4, background: done ? "#f59e0b" : "rgba(255,255,255,0.05)", borderRadius: 2, transition: "background 0.3s ease", boxShadow: done ? "0 0 10px rgba(245,158,11,0.4)" : "none" }} />
              ))}
            </div>
            <button onClick={handleStartMatch} disabled={!canProceed} className="amber-btn">
              {canProceed ? "FIND MATCHES" : "COMPLETE PROFILE TO CONTINUE"}
            </button>
          </div>
        )}

        {/* MATCHING */}
        {phase === "matching" && (
          <div style={{ animation: "fadeIn 0.5s ease forwards", marginTop: 40 }}>
            <div style={{ textAlign: "center", marginBottom: 40 }}>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 24, fontWeight: 900, color: "#f4f4f5", marginBottom: 8 }}>
                <GlitchTitle text="FINDING YOUR MATCHES" />
              </div>
              <div style={{ color: "#f59e0b", fontSize: 14, fontWeight: 500 }}>
                {candidates.length === 0 ? `AI PROCESSING FOR ${userName.toUpperCase()}...` : `TOP ${candidates.length} MATCHES FOR ${userName.toUpperCase()}`}
              </div>
            </div>
            {candidates.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 0" }}>
                <div style={{ width: 64, height: 64, border: "3px solid rgba(245,158,11,0.2)", borderTopColor: "#f59e0b", borderRadius: "50%", margin: "0 auto 24px", animation: "spin 1s linear infinite" }} />
                <div style={{ color: "#a1a1aa", fontSize: 14, fontWeight: 500 }}>Analyzing attendance data...</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            ) : (
              <MatchAnimation candidates={candidates} onComplete={(allMatches) => { setTopMatch(allMatches); setPhase("result"); }} />
            )}
          </div>
        )}

        {/* RESULT */}
        {phase === "result" && topMatch && (
          <div style={{ animation: "fadeIn 0.6s ease forwards", marginTop: 10 }}>
            <div style={{ textAlign: "center", marginBottom: 36 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>Matches Found For</div>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 32, fontWeight: 900, color: "#f4f4f5" }}>{userName}</div>
            </div>
            <MatchList
              candidates={topMatch}
              onSelectProfile={setSelectedProfile}
              onReset={handleReset}
              onRematch={async () => {
                setTopMatch(null);
                setCandidates([]);
                setMatchError(null);
                setPhase("matching");
                try {
                  const res = await fetch("/api/match", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userName, userDomain, userInterests, userProfile }),
                  });
                  const data = await res.json();
                  if (!res.ok || data.error) throw new Error(data.error || "Match failed");
                  setCandidates(data.matches);
                } catch (err) {
                  setMatchError(err.message);
                  setPhase("result");
                  setTopMatch(topMatch);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Profile modal */}
      {selectedProfile && <ProfileModal person={selectedProfile} onClose={() => setSelectedProfile(null)} />}

      {/* Footer */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 10, padding: "16px 32px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", background: "rgba(10,10,14,0.8)", backdropFilter: "blur(12px)" }}>
        <div style={{ fontSize: 11, color: "#71717a", fontWeight: 500, letterSpacing: 1 }}>AI COMMUNITY LUCKNOW</div>
        <div style={{ fontSize: 11, color: "#a16207", fontWeight: 600, letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", animation: "orbPulse 2s infinite" }} />SYSTEM ONLINE</div>
      </div>
    </div>
  );
}
