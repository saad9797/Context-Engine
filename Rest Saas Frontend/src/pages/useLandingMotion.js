import { useEffect, useRef } from "react";

// Load motion only on the marketing page; the workspace doesn't need GSAP.
export default function useLandingMotion() {
  const root = useRef(null);
  useEffect(() => {
    let disposed = false;
    let media;
    let context;
    const listeners = [];
    Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(
      ([{ gsap }, { ScrollTrigger }]) => {
        if (disposed || !root.current) return;
        gsap.registerPlugin(ScrollTrigger);
        context = gsap.context(() => {
          const select = gsap.utils.selector(root.current);
          media = gsap.matchMedia();
          media.add({
            motion: "(prefers-reduced-motion: no-preference)",
            desktop: "(min-width: 761px)",
            pointer: "(hover: hover) and (pointer: fine)",
          }, ({ conditions }) => {
            if (!conditions.motion) return;
            const distance = conditions.desktop ? 36 : 18;
            gsap.from(select(".announcement, .hero h1, .hero-description, .hero-actions, .hero-note"), {
              y: distance, opacity: 0, duration: 0.9, stagger: 0.11,
              ease: "power3.out", clearProps: "all",
            });
            gsap.from(select(".hero-preview"), {
              y: 50, opacity: 0, duration: 1.15, delay: 0.35,
              ease: "power3.out", clearProps: "all",
            });
            select(".works-with, .problem-grid > div, .section-heading, .feature-card, .workflow-grid article, .trust-strip, .faq-section > div, .final-cta").forEach((element) => {
              gsap.from(element, {
                y: distance, opacity: 0, duration: 0.85, ease: "power3.out",
                scrollTrigger: { trigger: element, start: "top 92%", once: true },
                clearProps: "all",
              });
            });
            gsap.from(select(".chat-bubble"), {
              x: 20, opacity: 0, stagger: 0.15, duration: 0.6,
              scrollTrigger: { trigger: select(".before-after")[0], start: "top 85%", once: true },
              clearProps: "all",
            });
            gsap.from(select(".budget-track i"), {
              scaleX: 0, transformOrigin: "left", duration: 1.4, ease: "power3.inOut",
              scrollTrigger: { trigger: select(".budget-illustration")[0], start: "top 90%", once: true },
              clearProps: "all",
            });
            gsap.to(select(".reading-progress"), {
              scaleX: 1, ease: "none",
              scrollTrigger: { trigger: root.current, start: "top top", end: "bottom bottom", scrub: 0.2 },
            });
            if (conditions.desktop) {
              gsap.fromTo(select(".preview-depth"), { rotateX: 5, y: 12 }, {
                rotateX: 0, y: -12, ease: "none",
                scrollTrigger: { trigger: select(".hero-preview")[0], start: "top bottom", end: "bottom top", scrub: 1 },
              });
            }
            if (conditions.pointer) {
              select(".feature-card, .final-cta").forEach((card) => {
                const move = (event) => {
                  const box = card.getBoundingClientRect();
                  card.style.setProperty("--pointer-x", `${event.clientX - box.left}px`);
                  card.style.setProperty("--pointer-y", `${event.clientY - box.top}px`);
                };
                card.addEventListener("pointermove", move);
                listeners.push(() => {
                  card.removeEventListener("pointermove", move);
                  card.style.removeProperty("--pointer-x");
                  card.style.removeProperty("--pointer-y");
                });
              });
            }
            return () => listeners.splice(0).forEach((remove) => remove());
          });
        }, root);
      },
    ).catch(() => { /* Content remains usable if the optional motion chunk fails. */ });
    return () => {
      disposed = true;
      media?.revert();
      context?.revert();
      listeners.splice(0).forEach((remove) => remove());
    };
  }, []);
  return root;
}
