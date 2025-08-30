const AfricasTalking = require("africastalking");
require("dotenv").config();
// Initialize Africa's Talking SDK
const africastalking = AfricasTalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME, // Use 'sandbox' for testing
});

module.exports = async function sendSMS(number, message) {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      const result = await africastalking.SMS.send({
        to: number,
        message: message,
        from: 'INFORM',
      });
      console.log(result);
      return; // Exit if successful
    } catch (ex) {
      attempts++;
      console.error(`SMS sending failed (attempt ${attempts}):`, ex);
      if (attempts >= maxAttempts) {
        console.error("Max retry attempts reached. SMS not sent.");
      }
    }
  }
};
