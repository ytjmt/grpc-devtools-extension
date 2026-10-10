// Freeze motion so screenshots are stable.
const style = document.createElement("style");
style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }";
document.head.append(style);
