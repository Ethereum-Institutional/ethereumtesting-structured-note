export default function Pending() {
  return (
    <div className="wrap narrow">
      <header className="masthead">
        <p className="eyebrow">Structured Note Technical PoC</p>
        <h1 style={{ fontSize: "2.25rem" }}>Registration received</h1>
      </header>
      <p>Your email address is confirmed and your registration is awaiting approval.</p>
      <p className="muted">You will receive an email when access is granted.</p>
    </div>
  );
}
