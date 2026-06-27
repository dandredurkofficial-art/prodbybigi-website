const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {
  sendEmail,
  safeStr,
  RESEND_API_KEY,
  RESEND_FROM,
} = require("./emailUtils");

const db = admin.firestore();

exports.sendPremiereReminders = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "us-central1",
    timeZone: "UTC",
    secrets: [RESEND_API_KEY, RESEND_FROM],
  },
  async () => {
    const now = Date.now();

    try {
      const beatsSnap = await db
        .collection("beats")
        .where("isPremiere", "==", true)
        .get();

      if (beatsSnap.empty) {
        console.log("No premiere beats found.");
        return;
      }

      for (const beatDoc of beatsSnap.docs) {
        const beat = beatDoc.data();

        if (beat.premiereReminderSent === true) continue;

        const premiereAt = Number(beat.premiereAt || 0);

        if (!premiereAt || premiereAt > now) continue;

        console.log(`Processing reminders for beat ${beatDoc.id}`);

        const reminderSnap = await db
          .collection("premiereReminders")
          .where("beatId", "==", beatDoc.id)
          .get();

        if (reminderSnap.empty) {
          await beatDoc.ref.update({
            premiereReminderSent: true,
          });

          console.log("No reminder subscribers.");
          continue;
        }

        for (const reminderDoc of reminderSnap.docs) {
          const reminder = reminderDoc.data();

          if (reminder.emailed === true) continue;

          const email = safeStr(reminder.email);

          if (!email) continue;

          try {
            await sendEmail({
              to: email,
              subject: `${safeStr(
                beat.title || "Your premiere"
              )} is now LIVE on Audiory`,
              text:
                `Hi,\n\n` +
                `The beat you requested a reminder for is now live.\n\n` +
                `Beat: ${safeStr(beat.title)}\n\n` +
                `Listen now:\n` +
                `https://audiory.site/beat/?id=${beatDoc.id}`,
              html: `
<div style="margin:0;padding:0;background:#0b0d12;font-family:Inter,Arial,sans-serif;color:#fff;">
  <div style="max-width:620px;margin:0 auto;padding:40px 16px;">

    <div style="background:#121726;border:1px solid #1d2230;border-radius:20px;padding:32px;">

      <h1 style="margin:0 0 12px;font-size:30px;">
        🎉 Your Premiere Is Live
      </h1>

      <p style="color:#b6bfd6;font-size:16px;line-height:1.7;">
        The beat you asked Audiory to remind you about has just gone live.
      </p>

      <div style="margin:28px 0;padding:18px;background:#181d2d;border-radius:14px;">

        <h2 style="margin:0 0 10px;font-size:22px;color:#fff;">
          ${safeStr(beat.title)}
        </h2>

        <p style="margin:0;color:#9ca3af;">
          Don't miss out. Listen now before everyone else.
        </p>

      </div>

      <div style="margin-top:30px;text-align:center;">

        <a
          href="https://audiory.site/beat/?id=${beatDoc.id}"
          style="
            display:inline-block;
            background:#6d5dfc;
            color:#fff;
            text-decoration:none;
            padding:15px 34px;
            border-radius:12px;
            font-weight:700;
            font-size:16px;
          "
        >
          ▶ Listen Now
        </a>

      </div>

      <p style="margin-top:34px;color:#8b93a7;font-size:14px;line-height:1.7;">
        You're receiving this email because you clicked
        <strong>Remind Me</strong> on Audiory.
      </p>

    </div>

  </div>
</div>
              `,
            });

            await reminderDoc.ref.update({
              emailed: true,
              emailedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            console.log(`Reminder sent to ${email}`);

          } catch (err) {
            console.error(
              `Failed sending reminder to ${email}`,
              err
            );
          }
        }

        await beatDoc.ref.update({
          premiereReminderSent: true,
          premiereReminderSentAt:
            admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(
          `Finished reminders for beat ${beatDoc.id}`
        );
      }

      console.log("Premiere reminder scheduler finished.");

    } catch (err) {
      console.error(
        "Premiere reminder scheduler failed:",
        err
      );
    }
  }
);
