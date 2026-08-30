/* =========================================
   AUDIORY VERIFIED BADGES (GLOBAL)
========================================= */

window.AudioryVerify = {

  badge(plan){

    const p = String(plan || "").toLowerCase();

    // Classic rounded circle verified badge SVG
    const classicCheckmarkSvg = `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.2 13.3l-3.5-3.5 1.4-1.4 2.1 2.1 5.3-5.3 1.4 1.4-6.7 6.7z"/>
      </svg>
    `.trim();

    if(p === "pro"){
      return `
      <span class="verify-badge verify-pro" title="Pro Verified">
        ${classicCheckmarkSvg}
      </span>`;
    }

    if(p === "elite"){
      return `
      <span class="verify-badge verify-elite" title="Elite Verified">
        ${classicCheckmarkSvg}
      </span>`;
    }

    return "";
  }

};
