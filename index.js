const express = require("express");
const { Pool } = require("pg");
const app = express();
const sendSMS = require("./SMS.js");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
require("dotenv").config();

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "agriconnect drone hub",
  password: "mi vida",
  port: 5432,
});

//  fast-api coonection link
// const 

const calculateDronesAndPrice = (plotSize, droneCoverage, pricePerDrone) => {
  const numberOfDrones = Math.ceil(plotSize / droneCoverage);
  const totalPricePerHour = numberOfDrones * pricePerDrone;
  return { numberOfDrones, totalPricePerHour };
};

const getUserByPhoneNumber = async (phoneNumber) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email FROM users WHERE phone_number = $1",
      [phoneNumber]
    );
    return result.rows.length ? result.rows[0] : null;
  } catch (error) {
    console.error("Database error (getUserByPhoneNumber):", error);
    return null;
  }
};

const fetchAndSendPaymentHistory = async (userId, phoneNumber) => {
  try {
    // Query to fetch payment history for the last 3 days
    const result = await pool.query(
      `SELECT id, amount, payment_method, transaction_id, status 
       FROM payments 
       WHERE id = $1 AND created_at >= NOW() - INTERVAL '3 days'
       ORDER BY created_at DESC`,
      [userId]
    );

    if (result.rows.length) {
      // Format the payment history for SMS
      const paymentHistory = result.rows
        .map(
          (payment, index) =>
            `${index + 1}. Amount: ${payment.amount} Tsh\n   Method: ${payment.payment_method}\n   Transaction ID: ${payment.transaction_id}\n   Status: ${payment.status}`
        )
        .join("\n\n");

      // Send SMS with payment history
      await sendSMS(
        phoneNumber,
        `Your payment history for the last 3 days:\n\n${paymentHistory}`
      );

      return `END Your payment history has been sent to your phone via SMS.`;
    } else {
      // No payments found in the last 3 days
      return `END No payment history found for the last 3 days.`;
    }
  } catch (error) {
    console.error("Database error (fetch payment history):", error);
    return `END Error fetching payment history. Please try again later.`;
  }
};

const checkAvailableStalls = async () => {
  try {
    const result = await pool.query(
      `SELECT id, stall_number 
       FROM stalls 
       WHERE is_available = TRUE 
       ORDER BY stall_number ASC`
    );

    if (result.rows.length) {
      return {
        status: "available",
        stalls: result.rows,
      };
    }

    return {
      status: "not_available",
      message: "Currently, there are no open stalls available for rent.",
    };
  } catch (error) {
    console.error("Database error (checkAvailableStalls):", error);
    return {
      status: "error",
      message: "Error fetching available stalls. Please try again later.",
    };
  }
};



const userSessions = {};

app.post("/ussd-fastapi", async (req, res) => {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;

  let response = "";

  // Initialize session if not already set
  if (!userSessions[sessionId]) {
    userSessions[sessionId] = { state: "fastapi_menu" };
  }

  const session = userSessions[sessionId];
  const input = text ? text.split("*").pop() : "";

  console.log(`FastAPI Route - Session ID: ${sessionId}, State: ${session.state}, Input: ${text}, Latest Input: ${input}`);

  try {
    // Call FastAPI endpoint
    const fastApiResponse = await axios.post("http://localhost:8000/api/ussd-process", {
      phoneNumber,
      text,
      sessionId,
    });

    const { message, status } = fastApiResponse.data;

    // Ensure response is USSD-compatible
    if (status === "CON" || status === "END") {
      response = `${status} ${message}`;
    } else {
      response = `END Invalid response from server.`;
    }

    // Clear session if END
    if (status === "END") {
      delete userSessions[sessionId];
    }
  } catch (error) {
    console.error("FastAPI error:", error.message);
    response = `END Error connecting to service. Please try again later.`;
    delete userSessions[sessionId];
  }

  res.set("Content-Type: text/plain");
  res.send(response);
});


app.post("/ussd", async (req, res) => {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;

  let response = "";

  // Initialize session if not already set
  if (!userSessions[sessionId]) {
    userSessions[sessionId] = { state: "main_menu" };
  }

  const session = userSessions[sessionId];
  const input = text ? text.split("*").pop() : "";

  console.log(
    `Session ID: ${sessionId}, State: ${session.state}, Input: ${text}, Latest Input: ${input}`
  );

  if (session.state === "main_menu" && text === "") {
    response = `CON Karibu Mjasiriamali wa Soko la Mwenge! Chagua huduma:
        1. Fanya Malipo
        2. Omba eneo la biashara
        3. Angalia Historia ya Malipo
        4. Ripoti Tatizo`;
  } else if (session.state === "main_menu") {
    const user = await getUserByPhoneNumber(phoneNumber);
    if (!user && input !== "1") {
      response = `END User not found. Please register or request a drone to continue.`;
      delete userSessions[sessionId];
    } else {
      if (input === "1") {
        session.state = "select_stall";
        response = `CON Chagua eneo lako la biashara:
          1. 001-A
          2. 002-B
          3. 003-C
          4. 004-D
          5. Next`;
      } else if (input === "2") {
        const stallStatus = await checkAvailableStalls();
        if (stallStatus.status === "available") {
          const stallOptions = stallStatus.stalls
            .map(
              (stall, index) =>
                `${index + 1}. Stall ${stall.stall_number}`
            )
            .join("\n");

          response = `CON Available stalls for rent:\n${stallOptions}\nSelect a stall by entering its number:`;
          session.state = "select_stall";
          session.stalls = stallStatus.stalls;
        } else if (stallStatus.status === "not_available") {
          response = `END ${stallStatus.message}`;
          delete userSessions[sessionId];
        } else {
          response = `END ${stallStatus.message}`;
          delete userSessions[sessionId];
        }
      } else if (input === "3") {
        session.state = "payment_history";
        session.userId = user.id;

        // Call the function to fetch and send payment history
        response = await fetchAndSendPaymentHistory(user.id, phoneNumber);
        delete userSessions[sessionId];

      } else if (input === "4") {
        session.state = "report_issue";
        session.userId = user.id;
        response = `CON Andika tatizo linalokusibu eneo lako la kazi (e.g Kubomolewa kibanda, Uchafu haujazolewa n.k):`;
      } else {
        response = `CON Karibu Mjasiriamali wa Soko la Mwenge! Chagua huduma:
        1. Fanya Malipo
        2. Omba eneo la biashara
        3. Angalia Historia ya Malipo
        4. Ripoti Tatizo`;
      }
    }

  } else if (session.state === "select_stall") {
    const selectedIndex = parseInt(input) - 1;

    if (
      isNaN(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= 4
    ) {
      response = `CON Invalid selection. Please select a valid stall number:`;
    } else {
      session.selectedStall = `00${selectedIndex + 1}-${String.fromCharCode(65 + selectedIndex)}`;
      session.state = "confirm_payment";
      response = `CON You have selected Stall ${session.selectedStall}. Unakaribia kulipa 1000 Tsh kwaajili ya ushuru. Unathibitisha?
        1. Yes
        2. No`;
    }
  } else if (session.state === "confirm_payment") {
    if (input === "1") {
      session.state = "enter_pin";
      response = `CON Weka namba ya siri kuthibitisha malipo.`;
    } else if (input === "2") {
      response = `END Malipo yamebatilishwa . Asante kwa kutumia Mwenge Market services.`;
      delete userSessions[sessionId];
    } else {
      response = `CON Invalid option. Please select:
        1. Yes
        2. No`;
    }
  } else if (session.state === "enter_pin") {
    const enteredPin = input;
    const validPin = "1234"; // Hardcoded PIN for confirmation

    if (enteredPin === validPin) {
      try {
        const transactionId = uuidv4(); // Generate a unique transaction ID

        // Insert payment record into the database
        await pool.query(
          "INSERT INTO payments (amount, payment_method, transaction_id, status) VALUES ($1, $2, $3, $4)",
          [1000, "USSD", transactionId, "SUCCESS"]
        );

        // Send SMS confirmation
        sendSMS(
          phoneNumber,
          `Malipo yako ya 1000 Tsh kwa ajili ya Kibanda ${session.selectedStall} yamekamilika. Transaction ID: ${transactionId}. \nKumbuka kulipa ushuru kesho tena.`
        );

        response = `END Malipo yamekamilika! Asante kwa kulipa ushuru. Kumbuka kulipa kesho tena.`;
        delete userSessions[sessionId];
      } catch (error) {
        console.error("Database error (process payment):", error);
        response = `END Error processing your payment. Please try again later.`;
        delete userSessions[sessionId];
      }
    } else {
      session.retryCount = (session.retryCount || 0) + 1;
      if (session.retryCount < 3) {
        response = `CON Invalid PIN. Please try again (${3 - session.retryCount} attempts left).`;
      } else {
        response = `END Too many invalid PIN attempts. Please start over.`;
        delete userSessions[sessionId];
      }
    }
  }
  else if (session.state === "confirm_details") {
    if (input === "1") {
      session.state = "enter_pin";
      response = `CON Enter your PIN to confirm payment.`;
    } else if (input === "2") {
      response = `END Request canceled. Thank you for using AgriConnect Drone Hub.`;
      delete userSessions[sessionId];
    } else {
      response = `CON Invalid option. Please select:
        1. Yes
        2. Cancel`;
    }
  } else if (session.state === "report_issue") {
    if (input.trim() === "") {
      response = `CON Maelezo ya tatizo hayawzi kuwa buntu, tafadhali eleza tatizo linalokusibu:`;
    } else {
      try {
        await pool.query(
          "INSERT INTO issues (user_id, issue_description, status) VALUES ($1, $2, $3)",
          [session.userId, input, "submitted"]
        );
        response = `END Tatizo lako limepokelewa kikamilifu! Timu yetu italishughulikia hivi punde.`;
        sendSMS(
          phoneNumber,
          `Tatizo lako limepokelewa: "${input}". \n\nTimu ya soko la Mwenge itakushughulikia hivi punde! \nAsante kwa kutumia huduma zetu!`
        );
        delete userSessions[sessionId];
      } catch (error) {
        console.error("Database error (report issue):", error);
        response = `END Error reporting issue. Please try again later.`;
        delete userSessions[sessionId];
      }
    }
  } else {
    response = `END Invalid input. Please try again.`;
    delete userSessions[sessionId];
  }

  res.set("Content-Type: text/plain");
  res.send(response);
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`USSD Server running on http://localhost:${PORT}`);
});
