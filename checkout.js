// checkout.js
const beat = JSON.parse(localStorage.getItem("checkoutBeat"));

if (!beat) {
  document.body.innerHTML = "No beat selected";
}

window.payNow = () => {
  window.location.href = `/functions/createPayPalPayment?price=${beat.price}`;
};
