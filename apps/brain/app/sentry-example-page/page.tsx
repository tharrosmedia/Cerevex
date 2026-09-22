"use client";

import { useState } from "react";

export default function SentryExamplePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);

  function throwClientError() {
    // This error will be captured by Sentry in the browser
    throw new Error("Sentry Test Error - Client Component");
  }

  async function triggerServerError() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/sentry-example-api");
      // If the API throws, it may still return something or error
      if (!res.ok) {
        console.error("API responded with error");
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
    setIsLoading(false);
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Sentry Example Page</h1>
      <p>
        This page helps you verify that Sentry is working correctly in your Next.js app.
      </p>

      <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
        <button
          onClick={throwClientError}
          style={{
            padding: "0.75rem 1.25rem",
            background: "#e11d48",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Throw Sample Client Error
        </button>

        <button
          onClick={triggerServerError}
          disabled={isLoading}
          style={{
            padding: "0.75rem 1.25rem",
            background: "#1e40af",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: isLoading ? "not-allowed" : "pointer",
            opacity: isLoading ? 0.7 : 1,
          }}
        >
          {isLoading ? "Loading..." : "Trigger Server/API Error"}
        </button>
      </div>

      <p style={{ marginTop: "2rem", fontSize: "0.9rem", color: "#666" }}>
        After triggering an error, check your Sentry dashboard under Issues.
        <br />
        You should see the error with a stack trace pointing to this file.
      </p>

      {eventId && <p>Event ID: {eventId}</p>}
    </div>
  );
}
