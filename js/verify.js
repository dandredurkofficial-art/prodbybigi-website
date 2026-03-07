/* =========================================
   AUDIORY VERIFIED BADGES (GLOBAL)
========================================= */

window.AudioryVerify = {

  badge(plan){

    const p = String(plan || "").toLowerCase();

    if(p === "pro"){
      return `
      <span class="verify-badge verify-pro" title="Pro Verified">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.5 12l-2.1-2.4.3-3.2-3.1-.7L16 2.8l-3 1.7-3-1.7-1.6 2.9-3.1.7.3 3.2L1.5 12l2.1 2.4-.3 3.2 3.1.7L8 21.2l3-1.7 3 1.7 1.6-2.9 3.1-.7-.3-3.2L22.5 12zM10.2 15.3l-2.5-2.5 1.1-1.1 1.4 1.4 4-4 1.1 1.1-5.1 5.1z"/>
        </svg>
      </span>`;
    }

    if(p === "elite"){
      return `
      <span class="verify-badge verify-elite" title="Elite Verified">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.5 12l-2.1-2.4.3-3.2-3.1-.7L16 2.8l-3 1.7-3-1.7-1.6 2.9-3.1.7.3 3.2L1.5 12l2.1 2.4-.3 3.2 3.1.7L8 21.2l3-1.7 3 1.7 1.6-2.9 3.1-.7-.3-3.2L22.5 12zM10.2 15.3l-2.5-2.5 1.1-1.1 1.4 1.4 4-4 1.1 1.1-5.1 5.1z"/>
        </svg>
      </span>`;
    }

    return "";
  }

};
