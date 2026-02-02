//node packages
const cron = require("node-cron");
const nodemailer = require("nodemailer");
require("dotenv").config();

//globals
const FREEPBX_API_URL = process.env.FREEPBX_API_URL;
const FREEPBX_GQL_URL = process.env.FREEPBX_GQL_URL;
const FREEPBX_CLIENT_ID = process.env.FREEPBX_CLIENT_ID;
const FREEPBX_CLIENT_SECRET = process.env.FREEPBX_CLIENT_SECRET;
const FREEPBX_SCOPE = process.env.FREEPBX_SCOPE;
const RG1 = process.env.RG1;
const RG2 = process.env.RG2;
const RG3 = process.env.RG3;
const PBX_CID = process.env.PBX_CID;
const CRON_STRING = process.env.CRON_STRING;
const SCHEDULE_URL = process.env.SCHEDULE_URL;
const SCHEDULE_TOKEN = process.env.SCHEDULE_TOKEN;
const TZ = process.env.TZ;
const ERROR_EMAIL_ADDRESS = process.env.ERROR_EMAIL_ADDRESS;
const SMTP_SERVER = process.env.SMTP_SERVER;
const SMTP_PORT = process.env.SMTP_PORT;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const ringgroups = [RG1, RG2, RG3];
let currentRecipients = {};
let hash;


//oauth config
const config = {
  client: {
    id: FREEPBX_CLIENT_ID,
    secret: FREEPBX_CLIENT_SECRET,
  },
  auth: {
    tokenHost: FREEPBX_API_URL,
    tokenPath: "token"
  },
  http: {
    json: "strict",
    redirects: true
  }
};

const { ClientCredentials } = require("simple-oauth2");
const client = new ClientCredentials(config);
const tokenParams = {
  scope: FREEPBX_SCOPE.split(" "),
};

//mailer config
const transporter = nodemailer.createTransport({
  host: SMTP_SERVER,
  port: SMTP_PORT,
  secure: SMTP_PORT == 465, // Use true for port 465, false for port 587
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

//helper functions
const handleError = async (msg) => {
  const info = await transporter.sendMail({
    from: '"DiALERT Error" <noreply@wemsapp.com>',
    to: ERROR_EMAIL_ADDRESS,
    subject: "DiALERT Error Notification",
    text: `An error occurred: ${msg}\n\n\nCurrent time: ${new Date().toString()}`,
    html: `<b>An error occurred:</b> ${msg}\n<br/><br/><b>Current time:</b> ${new Date().toString()}`,
  });
  console.error("Error email sent: ", msg);
  return console.error("Message ID: ", info.messageId);
}

const getCurrentSchedule = async () => {
  const res = await fetch(SCHEDULE_URL, {
    method: "GET",
    headers: {
      "x-api-key": SCHEDULE_TOKEN,
    },
  });
  if (!res.ok) {
    return handleError(`Failed to fetch schedule: ${res.status} ${res.statusText}\nSchedule URL: ${SCHEDULE_URL}`);
  }
  const body = await res.json();
  if (body.error) {
    console.error("Schedule API error: ", body.error);
    return;
  }
  return {hash: body.hash, recipients: body.recipients};
}

const updatePbx = async (recipients) => {
  let accessToken;
  try {
    accessToken = await client.getToken(tokenParams);
  } catch (error) {
    console.log("Access token error: ", error.message);
  }
  
  let statuses = [];

  for (let x = 0; x < 3; x++) {
    console.log(`Updating ring group ${ringgroups[x]} with recipient ${recipients[x].number}...`);
    const res = await fetch(FREEPBX_GQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken.token.access_token}`
      },
      body: JSON.stringify({
        query: `mutation{
        updateRingGroup(input:{
          groupNumber: "${ringgroups[x]}"
          description: "DiALERT Medcon ${x+1}"
          extensionList: "${recipients[x].number}#"
          strategy: "ringall"
          ringTime: "${x==0 ? 30 : 20}"
          changecid: "fixed"
          fixedcid: "${PBX_CID}"
        }) {
          message status
        }
      }`
      })
    });
    console.log(res);
    statuses.push(res.status);
  }

  console.log("Reloading PBX configuration...");
  const reloadRes = await fetch(FREEPBX_GQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken.token.access_token}`
    },
    body: JSON.stringify({
      query: `mutation{
        doreload(input:{}) {
          message
          status
          transaction_id
        }
      }`,
    }),
  });
  
  return {
    main: statuses,
    reload: reloadRes.status,
  };
};


const run = async () => {
  const res = await getCurrentSchedule();
  if (res.hash === hash) {
    console.log(`No changes in schedule at ${new Date().toString()}...`);
    return;
  }
  hash = res.hash;
  console.log(`Schedule change detected at ${new Date().toString()}, updating PBX...`);
  const updateRes = await updatePbx(res.recipients);
  console.debug(`PBX update statuses: ${JSON.stringify(updateRes)}`);
};

//cron scheduling
cron.schedule(
  CRON_STRING,
  () => {
    run();
  },
  { timezone: TZ }
);

(async () => {
  run();
})();