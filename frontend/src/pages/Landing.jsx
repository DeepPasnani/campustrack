import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/* ── Authored visuals ──────────────────────────────────────────
 * No stock photos, no white-noise overlays, no gradient washes.
 * every graphic is drawn from the site's own semantic tokens so the
 * page reads as one quiet, cohesive system.
 * ─────────────────────────────────────────────────────────────── */

// Small editorial screen mock built purely from tokens.
function MonacoMockClean() {
  return (
    <div className="rounded-xl border border-rim bg-panel p-5 shadow-raised">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="font-mono text-2xs font-semibold uppercase tracking-wider bg-sunken/60 px-2 py-1 rounded text-ink">main.py</span>
        <span className="text-2xs text-annotation">js</span>
        <span className="text-2xs text-annotation">java</span>
      </div>
      <div className="space-y-1.5">
        {[11, 8, 4, 7, 6, 3, 5, 4].map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-2xs font-mono text-annotation/60 w-4 text-right">{i + 1}</span>
            <div className={`h-1.5 rounded ${i % 2 ? 'bg-accent/40' : 'bg-rim'}`} style={{ width: `${w * 7}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MongoMock() {
  return (
    <div className="rounded-xl border border-rim bg-panel p-4 shadow-raised">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-2xs font-mono font-semibold uppercase tracking-wider bg-sunken px-2 py-1 rounded text-annotation">MCQ</span>
        <span className="text-2xs font-mono font-semibold uppercase tracking-wider bg-clarify/10 px-2 py-1 rounded text-clarify">Coding</span>
        <span className="text-2xs font-mono font-semibold uppercase tracking-wider bg-verify/10 px-2 py-1 rounded text-verify">Auto-graded</span>
      </div>
      <div className="space-y-2">
        {[80, 100, 60, 90].map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-1.5 w-2 rounded bg-rim/70" />
            <div className="h-1.5 rounded bg-accent/60" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-rim">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-annotation">Mean score</span>
          <span className="text-sm font-display font-bold text-ink">71%</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-2xs text-annotation">Median time</span>
          <span className="text-xs font-mono text-ink">26m 40s</span>
        </div>
      </div>
    </div>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setScrolled(window.scrollY > 24);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-panel/85 backdrop-blur border-b border-rim' : 'bg-transparent'}`}>
      <div className="max-w-7xl mx-auto px-6 lg:px-16">
        <div className="flex items-center justify-between h-16 lg:h-20">
          <Link to="/" className="flex items-center gap-3">
            <span className="font-display font-bold text-lg text-ink tracking-tight">CampusTrack</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-annotation hover:text-ink transition-colors">Features</a>
            <a href="#capabilities" className="text-sm text-annotation hover:text-ink transition-colors">Capabilities</a>
            <Link to="/login" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-panel text-sm font-semibold hover:bg-accent-dark transition-colors">
              Sign In
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative min-h-screen flex items-center pt-24 lg:pt-28">
      <div className="relative w-full max-w-7xl mx-auto px-6 lg:px-16">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-6">
            <p className="font-display text-xs font-semibold tracking-[0.2em] uppercase text-accent mb-6">Placement assessment, self-hosted</p>
            <h1 className="font-display font-bold text-[clamp(2.4rem,5.5vw,4.25rem)] leading-[1.08] tracking-tight text-ink">
              Run your placement tests without the paper trail.
            </h1>
            <p className="text-base lg:text-lg text-annotation max-w-lg mt-6 leading-relaxed">
              Aptitude tests, live coding challenges, and automated exam-integrity monitoring in one calm, self-hosted system. No third-party forms, no spreadsheets standing in the way.
            </p>
            <div className="flex flex-wrap gap-3 mt-9">
              <Link to="/login" className="inline-flex items-center gap-2 px-7 py-3.5 rounded-lg bg-accent text-panel text-sm font-bold hover:bg-accent-dark transition-colors">
                Get Started
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              <a href="#features" className="inline-flex items-center gap-2 px-7 py-3.5 rounded-lg border border-rim text-ink text-sm font-semibold hover:bg-panel transition-colors">
                Explore Features
              </a>
            </div>
          </div>
          <div className="lg:col-span-6">
            <div className="rounded-xl border border-rim bg-panel overflow-hidden shadow-raised">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-rim bg-sunken/40">
                <span className="w-2 h-2 rounded-full bg-rim" />
                <span className="w-2 h-2 rounded-full bg-rim" />
                <span className="w-2 h-2 rounded-full bg-rim" />
                <span className="ml-2 flex-1 h-4 rounded bg-rim/40 max-w-40" />
              </div>
              <div className="p-4 sm:p-5">
                <div className="flex gap-3">
                  <div className="w-14 rounded-lg bg-sunken p-2 space-y-2 shrink-0 hidden sm:block">
                    <div className="h-4 rounded bg-accent/12" />
                    <div className="h-1.5 rounded bg-rim/60" />
                    <div className="h-1.5 rounded bg-rim/60" />
                  </div>
                  <div className="flex-1 space-y-2.5">
                    <div className="flex items-center justify-between rounded-lg bg-accent/8 px-3 py-2">
                      <div className="space-y-1.5">
                        <div className="h-1.5 rounded bg-rim/60 w-24" />
                        <div className="h-2 rounded bg-accent w-10" />
                      </div>
                      <div className="h-6 w-12 rounded bg-accent" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg p-2 space-y-1.5">
                        <div className="h-1.5 rounded bg-rim/50 w-16" />
                        <div className="h-2 rounded bg-accent w-8" />
                      </div>
                      <div className="rounded-lg p-2 space-y-1.5">
                        <div className="h-1.5 rounded bg-rim/50 w-16" />
                        <div className="h-2 rounded bg-accent w-8" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="h-1.5 rounded bg-rim/60" />
                      <div className="h-1.5 rounded bg-rim/60 w-3/4" />
                      <div className="h-1.5 rounded bg-rim/60 w-1/2" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BentoFeatures() {
  const sectionRef = useRef(null);

  useGSAP(() => {
    const cards = sectionRef.current.querySelectorAll('.bento-card');
    cards.forEach((card, i) => {
      gsap.fromTo(card, { y: 40, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.6, delay: i * 0.08, ease: 'power2.out',
        scrollTrigger: { trigger: card, start: 'top bottom-=60', toggleActions: 'play none none none' },
      });
    });
  }, { scope: sectionRef });

  return (
    <section ref={sectionRef} id="features" className="py-28 lg:py-40">
      <div className="max-w-7xl mx-auto px-6 lg:px-16">
        <div className="max-w-2xl mb-16">
          <p className="font-display text-xs font-semibold tracking-[0.2em] uppercase text-accent mb-4">Platform Capabilities</p>
          <h2 className="font-display font-bold text-3xl lg:text-4xl text-ink leading-[1.1] tracking-tight">
            Everything you need to run placements at scale
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
          <article className="rounded-xl border border-rim bg-panel p-6 lg:p-7 hover:border-accent/30 transition-colors">
            <h3 className="font-display font-bold text-lg text-ink mb-2">Test Builder</h3>
            <p className="text-sm text-annotation">Three-step wizard for multi-section tests with MCQ and coding rounds, each with its own timer and grading rules.</p>
          </article>
          <article className="rounded-xl border border-rim bg-panel p-6 lg:p-7 hover:border-accent/30 transition-colors">
            <h3 className="font-display font-bold text-lg text-ink mb-2">Question Bank</h3>
            <p className="text-sm text-annotation">Build a reusable library once, then pull questions into any future test. No rebuilding from scratch.</p>
          </article>
          <article className="rounded-xl border border-rim bg-panel p-6 lg:p-7 hover:border-accent/30 transition-colors">
            <h3 className="font-display font-bold text-lg text-ink mb-2">Live Code Execution</h3>
            <p className="text-sm text-annotation">Monaco editor with offline grading against hidden test cases. Python, Java, C and C++ with instant feedback.</p>
          </article>
          <article className="rounded-xl border border-rim bg-panel p-6 lg:p-7 hover:border-accent/30 transition-colors">
            <h3 className="font-display font-bold text-lg text-ink mb-2">Exam Integrity Monitoring</h3>
            <p className="text-sm text-annotation">Automated tab-switch and fullscreen-exit monitoring with auto-saved answers, plus invigilator review of flagged sessions. No extra hardware needed.</p>
          </article>
          <article className="rounded-xl border border-rim bg-panel p-6 lg:p-7 hover:border-accent/30 transition-colors">
            <h3 className="font-display font-bold text-lg text-ink mb-2">Results & Analytics</h3>
            <p className="text-sm text-annotation">Score distributions, percentiles, per-question breakdowns and one-click CSV export on a single dashboard.</p>
          </article>
          <article className="rounded-xl border border-rim bg-panel p-6 lg:p-7 hover:border-accent/30 transition-colors">
            <h3 className="font-display font-bold text-lg text-ink mb-2">Granular Controls</h3>
            <p className="text-sm text-annotation">Per-section timers, passing thresholds, difficulty levels and optional negative marking, all tuned to your blueprint.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

function Capabilities() {
  return (
    <section id="capabilities" className="py-20 lg:py-36 bg-panel/60 border-y border-rim">
      <div className="max-w-7xl mx-auto px-6 lg:px-16">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-5">
            <p className="font-display text-xs font-semibold tracking-[0.2em] uppercase text-clarify mb-4">Deep Capabilities</p>
            <h2 className="font-display font-bold text-3xl lg:text-4xl text-ink leading-[1.1] tracking-tight">
              Purpose-built for campus recruitment
            </h2>
            <p className="text-annotation mt-5 leading-relaxed max-w-sm">
              Every feature is engineered for the scale, security and flexibility of college placement drives, from first-year internships to final-year hiring.
            </p>
          </div>
          <div className="lg:col-span-7 space-y-8">
            <div className="grid sm:grid-cols-2 gap-4">
              <MonacoMockClean />
              <MongoMock />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkflowSection() {
  const sectionRef = useRef(null);

  useGSAP(() => {
    const items = sectionRef.current.querySelectorAll('.flow-item');
    items.forEach((item, i) => {
      gsap.fromTo(item, { y: 32, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.6, delay: i * 0.1, ease: 'power2.out', immediateRender: false,
        scrollTrigger: { trigger: item, start: 'top bottom-=40', toggleActions: 'play none none none' },
      });
    });
  }, { scope: sectionRef });

  const steps = [
    { n: '01', title: 'Create Tests', desc: 'Multi-section tests with MCQ and coding rounds. Per-section timers, pass criteria and difficulty set up in a few clicks.' },
    { n: '02', title: 'Invite Students', desc: 'Unique test links or CSV cohort import. Students sign in with Google, so there is no manual account creation.' },
    { n: '03', title: 'Monitor Live', desc: 'Real-time progress from WebSocket heartbeats. See who is active, who switched tabs, who submitted — all on one screen.' },
    { n: '04', title: 'Evaluate & Export', desc: 'Instant grading and reports. Resume interrupted sessions without losing work.' },
  ];

  return (
    <section ref={sectionRef} className="py-20 lg:py-40">
      <div className="max-w-7xl mx-auto px-6 lg:px-16">
        <div className="max-w-2xl mb-16">
          <p className="font-display text-xs font-semibold tracking-[0.2em] uppercase text-accent mb-4">Workflow</p>
          <h2 className="font-display font-bold text-3xl lg:text-4xl text-ink leading-[1.1] tracking-tight">
            From creation to results, in four steps
          </h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {steps.map((s) => (
            <div key={s.n} className="flow-item rounded-lg border border-rim bg-panel p-7">
              <div className="flex items-center gap-3 mb-5">
                <span className="font-display font-bold text-2xl text-annotation/50">{s.n}</span>
                <span className="h-px flex-1 bg-rim" />
              </div>
              <h3 className="font-display font-bold text-lg text-ink mb-2">{s.title}</h3>
              <p className="text-sm text-annotation leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TechMarquee() {
  const marqueeRef = useRef(null);
  const techs = ['React', 'Node.js', 'PostgreSQL', 'MongoDB', 'Redis', 'Docker', 'Monaco', 'Google OAuth', 'WebSockets', 'Piston'];

  useGSAP(() => {
    const ctx = gsap.context(() => {
      gsap.to(marqueeRef.current, { xPercent: -50, duration: 36, ease: 'none', repeat: -1 });
    }, marqueeRef);
    return () => ctx.revert();
  });

  return (
    <section className="py-16 lg:py-20 border-y border-rim bg-panel/60">
      <div className="max-w-7xl mx-auto px-6 lg:px-16 mb-10">
        <p className="font-display text-xs font-semibold tracking-[0.2em] uppercase text-annotation/70 text-center">
          Built on modern, self-hostable infrastructure
        </p>
      </div>
      <div className="overflow-hidden border-y border-rim py-6">
        <div ref={marqueeRef} className="flex gap-12 items-center will-change-transform" style={{ width: 'fit-content' }}>
          {[...techs, ...techs].map((t, i) => (
            <span key={`${t}-${i}`} className="font-display font-semibold text-lg lg:text-xl text-ink/40 whitespace-nowrap tracking-tight select-none">
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function ShowcaseSection() {
  // Honest, verifiable capabilities — no invented student counts or dates.
  const facts = [
    { label: 'Languages', value: '4+', note: 'Python, Java, C, C++ in the bundled editor.' },
    { label: 'Multi-section', value: 'Any', note: 'Aptitude and coding rounds in one test.' },
    { label: 'Auto-saving', value: '+30s', note: 'Progress is saved throughout the session.' },
    { label: 'Export', value: 'CSV', note: 'Comprehensive results in one click.' },
  ];
  return (
    <section className="py-20 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-16">
        <div className="rounded-xl border border-rim bg-panel p-8 lg:p-12 grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {facts.map((f) => (
            <div key={f.label}>
              <div className="font-display font-bold text-3xl lg:text-4xl text-ink">{f.value}</div>
              <div className="text-sm font-semibold text-ink mt-1.5">{f.label}</div>
              <div className="text-sm text-annotation mt-1 leading-relaxed">{f.note}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="py-24 lg:py-32">
      <div className="max-w-4xl mx-auto px-6 lg:px-16 text-center">
        <h2 className="font-display font-bold text-4xl lg:text-5xl text-ink leading-[1.08] tracking-tight">
          Ready to run your next placement drive?
        </h2>
        <p className="text-lg text-annotation max-w-2xl mx-auto mt-6 leading-relaxed">
          Sign in with your college account to get started. Students access tests immediately; T&P cells get full administrative controls.
        </p>
        <div className="flex flex-wrap justify-center gap-4 mt-10">
          <Link to="/login" className="inline-flex items-center gap-2.5 px-8 py-4 rounded-lg bg-accent text-panel text-base font-bold hover:bg-accent-dark transition-colors">
            Get Started
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
          <a href="#capabilities" className="inline-flex items-center gap-2 px-8 py-4 rounded-lg border border-rim text-ink text-base font-semibold hover:bg-panel transition-colors">
            See Capabilities
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-rim py-14">
      <div className="max-w-7xl mx-auto px-6 lg:px-16">
        <div className="grid lg:grid-cols-4 gap-10">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <span className="font-display font-bold text-lg text-ink">CampusTrack</span>
            </div>
            <p className="text-sm text-annotation max-w-sm leading-relaxed">
              Open-source placement assessment for engineering colleges. Self-hosted, secure and designed for scale.
            </p>
          </div>
          <div>
            <p className="font-display font-semibold text-sm text-ink mb-4">Platform</p>
            <div className="space-y-3">
              <a href="#features" className="block text-sm text-annotation hover:text-ink transition-colors">Features</a>
              <a href="#capabilities" className="block text-sm text-annotation hover:text-ink transition-colors">Capabilities</a>
              <Link to="/login" className="block text-sm text-annotation hover:text-ink transition-colors">Sign In</Link>
            </div>
          </div>
          <div>
            <p className="font-display font-semibold text-sm text-ink mb-4">Get Started</p>
            <div className="space-y-3">
              <Link to="/login" className="block text-sm text-accent hover:text-accent transition-colors font-medium">Student Portal</Link>
              <Link to="/login" className="block text-sm text-accent hover:text-accent transition-colors font-medium">T&P Admin</Link>
            </div>
          </div>
        </div>
        <div className="mt-12 pt-7 border-t border-rim text-center">
          <p className="text-xs text-annotation">&copy; {new Date().getFullYear()} CampusTrack. Open-source under MIT.</p>
        </div>
      </div>
    </footer>
  );
}

export default function Landing() {
  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = 'var(--ct-deck)';
    return () => { document.body.style.backgroundColor = prev; };
  }, []);

  return (
    <main className="overflow-x-hidden w-full max-w-full min-h-screen bg-deck text-ink">
      <Nav />
      <Hero />
      <BentoFeatures />
      <Capabilities />
      <WorkflowSection />
      <TechMarquee />
      <ShowcaseSection />
      <CTA />
      <Footer />
    </main>
  );
}