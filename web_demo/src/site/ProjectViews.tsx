import { useCallback, useEffect, useRef, useState } from 'react';

import pipelineOverview from '../../../assets/figures/pipeline_overview.png';
import finalHeldoutResults from '../../../assets/figures/final_heldout_results.png';
import externalBenchmark from '../../../assets/figures/external_benchmark.png';
import errorCleanConfusion from '../../../assets/figures/error_clean_confusion.png';
import errorConditionRates from '../../../assets/figures/error_condition_rates.png';
import errorB1B2Transition from '../../../assets/figures/error_b1_b2_transition.png';
import errorFailureCases from '../../../assets/figures/error_failure_cases.png';

import { SignalField } from './SignalField';
import type { SiteRoute } from './routes';

type ProjectRoute = Exclude<SiteRoute, 'detector'>;

export interface ProjectImage {
  readonly src: string;
  readonly alt: string;
  readonly title: string;
}

type OpenProjectImage = (image: ProjectImage) => void;

export function shouldDismissProjectImageLightbox(target: unknown, currentTarget: unknown) {
  return target === currentTarget;
}

export function shouldDismissProjectImageLightboxFromKey(key: string) {
  return key === 'Escape';
}

export function ProjectImageLightbox({
  image,
  onClose,
}: {
  readonly image: ProjectImage | null;
  readonly onClose: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (image === null) return undefined;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldDismissProjectImageLightboxFromKey(event.key)) onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    backdropRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [image, onClose]);

  if (image === null) return null;
  return (
    <div
      className="project-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${image.title} enlarged image`}
      ref={backdropRef}
      tabIndex={-1}
      onClick={(event) => {
        if (shouldDismissProjectImageLightbox(event.target, event.currentTarget)) onClose();
      }}
    >
      <figure className="project-image-lightbox-figure">
        <button className="project-image-lightbox-close" type="button" onClick={onClose}>
          CLOSE
        </button>
        <img src={image.src} alt={image.alt} />
        <figcaption>{image.title}</figcaption>
      </figure>
    </div>
  );
}

function ProjectHeader({
  title,
  summary,
}: {
  readonly title: string;
  readonly summary: string;
}) {
  return (
    <header className="project-header">
      <SignalField />
      <p className="project-kicker">LINGSHU / {title}</p>
      <h1>{title}</h1>
      <p>{summary}</p>
    </header>
  );
}

function FigurePanel({
  src,
  alt,
  title,
  onExpand,
  children,
}: {
  readonly src: string;
  readonly alt: string;
  readonly title: string;
  readonly onExpand: OpenProjectImage;
  readonly children: React.ReactNode;
}) {
  return (
    <figure className="evidence-figure">
      <button
        className="figure-frame"
        type="button"
        aria-label={`Enlarge ${title} image`}
        aria-haspopup="dialog"
        onClick={() => onExpand({ src, alt, title })}
      >
        <img src={src} alt={alt} />
      </button>
      <figcaption>
        <strong>{title}</strong>
        <span>{children}</span>
      </figcaption>
    </figure>
  );
}

function TechnologyView({ onExpand }: { readonly onExpand: OpenProjectImage }) {
  const steps = [
    ['01', 'EXIF transpose', 'Honor camera orientation before any resizing.'],
    ['02', 'RGB conversion', 'Resolve every accepted still image to three ordered channels.'],
    ['03', '384 × 384 bicubic', 'Apply the frozen Catmull-Rom bicubic resize contract.'],
    ['04', 'Tensor + normalization', 'Convert to CHW FP32 and apply ImageNet mean and standard deviation.'],
    ['05', 'B2-NJR inference', 'Run the one disclosed FP32 ONNX model in the browser.'],
    ['06', 'Frozen decision', 'Compare probability against 0.55657113: at or above means AIGC.'],
  ] as const;

  return (
    <>
      <ProjectHeader
        title="TECHNOLOGY"
        summary="One disclosed preprocessing contract, one FP32 model, and one frozen decision rule run entirely inside the browser."
      />
      <section className="project-section technology-layout" aria-labelledby="runtime-route-title">
        <div>
          <h2 id="runtime-route-title">LOCAL RUNTIME ROUTE</h2>
          <p>
            WebGPU is attempted first. WASM is the compatibility fallback. Both providers load the
            same B2-NJR model and preserve the same threshold.
          </p>
          <dl className="model-contract-list">
            <div><dt>Model</dt><dd>B2-NJR</dd></div>
            <div><dt>Precision</dt><dd>FP32</dd></div>
            <div><dt>Input</dt><dd>1 × 3 × 384 × 384</dd></div>
            <div><dt>Threshold</dt><dd>0.55657113</dd></div>
          </dl>
        </div>
        <ol className="pipeline-list">
          {steps.map(([index, name, detail]) => (
            <li key={index}>
              <span>{index}</span>
              <div><strong>{name}</strong><p>{detail}</p></div>
            </li>
          ))}
        </ol>
      </section>
      <section className="project-section single-figure-section">
        <FigurePanel
          src={pipelineOverview}
          alt="Project pipeline overview figure"
          title="PIPELINE OVERVIEW"
          onExpand={onExpand}
        >
          Project figure shown for technical context. Browser runtime facts above remain the
          authoritative deployment contract.
        </FigurePanel>
      </section>
      <section className="project-section technical-notes-detail" aria-label="Technical notes">
        <article>
          <h2>BROWSER RUNTIME</h2>
          <p>
            The deployed detector applies EXIF orientation, RGB conversion, a direct 384 × 384
            bicubic resize, CHW FP32 tensor conversion, and ImageNet normalization before local
            B2-NJR inference. This is the authoritative browser contract.
          </p>
        </article>
        <article>
          <h2>DATASET & EVALUATION PREPARATION</h2>
          <p>
            The internal preparation note describes a different evaluation path: preserve aspect
            ratio, resize the short side to 384, center-crop to 384 × 384, then save PNG output.
            It must not be substituted for the browser runtime above.
          </p>
        </article>
        <article>
          <h2>ROBUSTNESS PROTOCOL</h2>
          <p>
            <strong>Internal data & benchmark note.</strong> The documented 70/15/15 split uses
            seed 20250828. The final NJR combination is Noise + JPEG + Resize, and evaluation uses
            14 FIXED CONDITIONS across JPEG, blur, resize, noise, color jitter, and center crop.
          </p>
        </article>
        <article>
          <h2>EVIDENCE BOUNDARY</h2>
          <p>
            The official demonstration set remains isolated from training. The exact-match audit
            reported no local training match, but that audit result is not absolute proof against
            every possible relationship or near-duplicate. Internal results are not presented as
            external competition results.
          </p>
        </article>
      </section>
    </>
  );
}

function ResultsView({ onExpand }: { readonly onExpand: OpenProjectImage }) {
  return (
    <>
      <ProjectHeader
        title="RESULTS"
        summary="Evaluation evidence is presented by source and scope. The two figures below answer different questions and are not one combined score."
      />
      <section className="project-section evidence-grid">
        <FigurePanel
          src={finalHeldoutResults}
          alt="Final held-out robustness results figure"
          title="HELD-OUT EVALUATION"
          onExpand={onExpand}
        >
          Internal held-out evaluation for the frozen project checkpoint and its named robustness
          conditions.
        </FigurePanel>
        <FigurePanel
          src={externalBenchmark}
          alt="External demonstration benchmark figure"
          title="EXTERNAL DEMONSTRATION"
          onExpand={onExpand}
        >
          Separate external demonstration benchmark. It is not a final competition result and does
          not replace the held-out evaluation.
        </FigurePanel>
      </section>
      <aside className="evidence-boundary">
        <strong>EVIDENCE BOUNDARY</strong>
        <p>
          Browser deployment parity, held-out robustness, and the external demonstration remain
          independently labeled throughout this site.
        </p>
      </aside>
    </>
  );
}

function ErrorsView({ onExpand }: { readonly onExpand: OpenProjectImage }) {
  return (
    <>
      <ProjectHeader
        title="ERROR ANALYSIS"
        summary="Measured failure modes of the frozen B2-NJR checkpoint at its validation-selected threshold, from clean-set misses to transformation-specific error direction."
      />
      <section className="project-section error-clean-overview" aria-labelledby="clean-error-title">
        <div className="error-clean-copy">
          <p className="error-scope">FROZEN B2-NJR / CLEAN HELD-OUT</p>
          <h2 id="clean-error-title" className="error-hero-number">19 / 4,485</h2>
          <p>
            Only 19 clean held-out images are misclassified at threshold 0.55657113. The remaining
            challenge is robustness under severe image degradation, not clean-set separation.
          </p>
          <dl className="error-stat-grid">
            <div><dt>6 FP</dt><dd>0.27% FPR</dd></div>
            <div><dt>13 FN</dt><dd>0.58% FNR</dd></div>
            <div><dt>99.5764%</dt><dd>Accuracy</dd></div>
          </dl>
        </div>
        <FigurePanel
          src={errorCleanConfusion}
          alt="B2-NJR clean held-out confusion matrix with 2244 true negatives, 6 false positives, 13 false negatives, and 2222 true positives"
          title="CLEAN ERROR PROFILE"
          onExpand={onExpand}
        >
          Frozen B2-NJR on the 4,485-image clean held-out set. The threshold was selected on
          validation data before this evaluation.
        </FigurePanel>
      </section>
      <section className="project-section error-evidence-pair" aria-labelledby="transformation-error-title">
        <FigurePanel
          src={errorConditionRates}
          alt="False-positive and false-negative rates for B2-NJR across clean and transformed held-out conditions"
          title="TRANSFORMATION ERROR DIRECTION"
          onExpand={onExpand}
        >
          Different transformations move errors in different directions; the bars report measured
          false-positive and false-negative rates for the frozen checkpoint.
        </FigurePanel>
        <div className="error-analysis-copy">
          <h2 id="transformation-error-title">TRANSFORMATION ASYMMETRY</h2>
          <p>
            Severe blur is false-positive dominant, aggressive downsampling is false-negative
            dominant, and strong Gaussian noise increases both error types. A single threshold
            shift therefore cannot remove every failure mode.
          </p>
          <div className="error-condition-grid">
            <article>
              <h3>BLUR σ=2.0</h3>
              <strong>10.00% FPR</strong>
              <p>225 FP / 9 FN</p>
            </article>
            <article>
              <h3>RESIZE ×0.25</h3>
              <strong>10.65% FNR</strong>
              <p>11 FP / 238 FN</p>
            </article>
            <article>
              <h3>NOISE σ=0.10</h3>
              <strong>327 ERRORS</strong>
              <p>204 FP / 123 FN</p>
            </article>
          </div>
        </div>
      </section>
      <section className="project-section error-evidence-pair error-transition-section" aria-labelledby="transition-error-title">
        <div className="error-analysis-copy">
          <h2 id="transition-error-title">WHAT B2 FIXES</h2>
          <p className="error-transition-number">1,611 → 327</p>
          <p>
            Under Gaussian noise σ=0.10, B2 corrects 1,455 B1 failures and introduces 171 new
            errors: a net reduction of 1,284 errors, or 79.7%. Comparable reductions appear under
            JPEG q30, resize ×0.25, and noise σ=0.05.
          </p>
          <p className="error-clean-tradeoff">
            Clean errors change from 16 to 19: three additional clean misses in exchange for a
            large reduction in corruption-induced failures.
          </p>
        </div>
        <FigurePanel
          src={errorB1B2Transition}
          alt="B1 errors fixed by B2 compared with new B2 errors across held-out transformation conditions"
          title="B1 → B2 ERROR TRANSITION"
          onExpand={onExpand}
        >
          Sample-level transitions distinguish errors corrected by robustness training from new
          errors introduced by the frozen B2 checkpoint.
        </FigurePanel>
      </section>
      <section className="project-section single-figure-section error-failure-section">
        <FigurePanel
          src={errorFailureCases}
          alt="Three representative false negatives and three representative false positives with their B2-NJR AIGC confidence scores"
          title="REPRESENTATIVE FAILURE CASES"
          onExpand={onExpand}
        >
          Top: AIGC images classified as real at scores 0.0389, 0.0448, and 0.0652. Bottom: real
          images classified as AIGC at scores 0.9993, 0.9937, and 0.8186.
        </FigurePanel>
        <div className="failure-reading-grid">
          <article>
            <h2>FALSE NEGATIVE</h2>
            <p>
              An AIGC image remains below the frozen threshold. The selected cases expose highly
              confident misses rather than borderline decisions.
            </p>
          </article>
          <article>
            <h2>FALSE POSITIVE</h2>
            <p>
              A real image crosses the frozen AIGC threshold. Visual cause labels require manual
              inspection and are not inferred from confidence alone.
            </p>
          </article>
        </div>
      </section>
      <aside className="evidence-boundary error-threshold-boundary">
        <strong>NO TEST-SET RETUNING</strong>
        <p>
          Every result on this page uses the validation-selected threshold 0.55657113. No
          threshold, checkpoint, or augmentation setting is retuned on the held-out test set.
          Transformation-aware calibration remains future work and must be learned without test
          leakage.
        </p>
      </aside>
    </>
  );
}

function AboutView() {
  const domains = [
    ['ROBUST MODEL', 'Training design, checkpoint selection, and frozen-threshold evaluation.'],
    ['EVIDENCE', 'Held-out reporting, external demonstration, and error-analysis boundaries.'],
    ['BROWSER RUNTIME', 'FP32 conversion, WebGPU/WASM execution, preprocessing parity, and offline packaging.'],
    ['JUDGE EXPERIENCE', 'Single-image workflow, technical narrative, visual system, and demonstration handoff.'],
  ] as const;

  return (
    <>
      <ProjectHeader
        title="ABOUT"
        summary="Why LingShu Intelligence built a local, inspectable AIGC detector for TikTok TechJam 2026."
      />
      <section className="project-section about-origin">
        <h2>WHY WE BUILT IT</h2>
        <p>
          TikTok TechJam 2026 is a 72-hour student hackathon built around five challenges and the
          theme “Build with joy, code for change.” LingShu responds to the robust AIGC-detection
          challenge with one-image browser inference that judges can run, understand, and inspect
          without sending the image to a server.
        </p>
        <a href="https://tiktoktechjam2026.devpost.com/" target="_blank" rel="noreferrer">
          OFFICIAL EVENT PAGE →
        </a>
      </section>
      <section className="project-section team-intro">
        <h2>TEAM — LINGSHU INTELLIGENCE</h2>
        <p className="team-pending">Profiles pending team confirmation</p>
        <p>
          The contribution map records verified work areas without assigning unconfirmed names,
          biographies, portraits, or individual roles.
        </p>
      </section>
      <section className="project-section contribution-grid" aria-label="Team contribution areas">
        {domains.map(([title, detail]) => (
          <article key={title}><h2>{title}</h2><p>{detail}</p></article>
        ))}
      </section>
      <section className="project-section about-thanks">
        <h2>THANKS</h2>
        <p>
          Thank you to TikTok, the TechJam organisers, workshop engineers, judges, and supporting
          teams for creating a focused environment for learning, building, and testing ideas.
          This acknowledgement does not imply endorsement of this project.
        </p>
      </section>
    </>
  );
}

export function ProjectView({ route }: { readonly route: ProjectRoute }) {
  const [expandedImage, setExpandedImage] = useState<ProjectImage | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openImage = useCallback((image: ProjectImage) => {
    openerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setExpandedImage(image);
  }, []);
  const closeImage = useCallback(() => {
    setExpandedImage(null);
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, []);

  useEffect(() => {
    setExpandedImage(null);
  }, [route]);

  let content: React.ReactNode = null;
  switch (route) {
    case 'technology':
      content = <TechnologyView onExpand={openImage} />;
      break;
    case 'results':
      content = <ResultsView onExpand={openImage} />;
      break;
    case 'errors':
      content = <ErrorsView onExpand={openImage} />;
      break;
    case 'about':
      content = <AboutView />;
      break;
  }
  return (
    <>
      <main id="main-content" className="project-view">{content}</main>
      <ProjectImageLightbox image={expandedImage} onClose={closeImage} />
    </>
  );
}
