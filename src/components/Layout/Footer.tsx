import React from "react";

const Footer: React.FC = () => (
  <footer className="border-t py-4 text-center text-xs text-muted-foreground" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
    © {new Date().getFullYear()}{" "}
    <a href="https://olivermandic.de" target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
      Oliver Mandić
    </a>
  </footer>
);

export default Footer;
