import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
    private readonly startedAt = new Date();

    getHello(): string {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="/assets/taskify_logo.png" type="image/png">
<title>Taskify API</title>

<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">

<style>

*{
    margin:0;
    padding:0;
    box-sizing:border-box;
    font-family:"Poppins",sans-serif;
}

body{
    height:100vh;
    display:flex;
    justify-content:center;
    align-items:center;
    background:linear-gradient(-45deg,#0f172a,#1e293b,#312e81,#0f766e);
    background-size:400% 400%;
    animation:bg 12s ease infinite;
    overflow:hidden;
}

@keyframes bg{
    0%{background-position:0% 50%;}
    50%{background-position:100% 50%;}
    100%{background-position:0% 50%;}
}

/* Background Glow */

body::before,
body::after{
    content:"";
    position:absolute;
    width:320px;
    height:320px;
    border-radius:50%;
    filter:blur(120px);
    z-index:0;
}

body::before{
    background:#3b82f6;
    top:-80px;
    left:-100px;
}

body::after{
    background:#8b5cf6;
    bottom:-100px;
    right:-100px;
}

.card{
    position:relative;
    z-index:2;
    width:760px;
    max-width:92%;
    padding:40px;
    border-radius:25px;
    background:rgba(255,255,255,.08);
    backdrop-filter:blur(20px);
    border:1px solid rgba(255,255,255,.15);
    box-shadow:0 25px 60px rgba(0,0,0,.35);
    color:white;
}

.header{
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:30px;
}

.logo h1{
    font-size:42px;
    font-weight:700;
}

.logo p{
    margin-top:6px;
    opacity:.7;
}

/* Status */

.status{
    display:flex;
    align-items:center;
    gap:10px;
    padding:10px 18px;
    border-radius:30px;
    background:rgba(34,197,94,.15);
    border:1px solid rgba(34,197,94,.35);
    color:#4ade80;
    font-weight:600;
}

.dot{
    width:12px;
    height:12px;
    background:#22c55e;
    border-radius:50%;
    position:relative;
}

.dot::before{
    content:"";
    position:absolute;
    inset:0;
    border-radius:50%;
    background:#22c55e;
    animation:pulse 1.8s infinite;
}

@keyframes pulse{
    0%{
        transform:scale(1);
        opacity:.8;
    }
    70%{
        transform:scale(3);
        opacity:0;
    }
    100%{
        transform:scale(3);
        opacity:0;
    }
}

/* Cards */

.grid{
    display:grid;
    grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
    gap:18px;
    margin-bottom:30px;
}

.box{
    background:rgba(255,255,255,.07);
    border:1px solid rgba(255,255,255,.08);
    padding:20px;
    border-radius:18px;
    transition:.3s;
}

.box:hover{
    transform:translateY(-6px);
    background:rgba(255,255,255,.12);
}

.box h3{
    font-size:14px;
    opacity:.7;
    margin-bottom:8px;
}

.box p{
    font-size:22px;
    font-weight:600;
}

/* Routes */

.routes h2{
    margin-bottom:18px;
}

.route{
    display:flex;
    justify-content:space-between;
    align-items:center;
    background:rgba(255,255,255,.06);
    border-radius:14px;
    padding:15px 18px;
    margin-bottom:12px;
    transition:.3s;
}

.route:hover{
    transform:translateX(8px);
    background:rgba(255,255,255,.12);
}

.method{
    background:#2563eb;
    padding:6px 14px;
    border-radius:8px;
    font-size:13px;
    font-weight:600;
}

/* Buttons */

.buttons{
    display:flex;
    gap:15px;
    margin-top:35px;
    flex-wrap:wrap;
}

.btn{
    text-decoration:none;
    padding:14px 24px;
    border-radius:12px;
    font-weight:600;
    transition:.3s;
}

.primary{
    background:#2563eb;
    color:white;
}

.primary:hover{
    background:#1d4ed8;
}

.secondary{
    background:rgba(255,255,255,.08);
    color:white;
    border:1px solid rgba(255,255,255,.15);
}

.secondary:hover{
    background:rgba(255,255,255,.15);
}

footer{
    margin-top:30px;
    text-align:center;
    opacity:.6;
    font-size:14px;
}

@media(max-width:700px){

.header{
    flex-direction:column;
    align-items:flex-start;
    gap:20px;
}

.logo h1{
    font-size:32px;
}

.buttons{
    flex-direction:column;
}

.btn{
    text-align:center;
}

}

</style>

</head>

<body>

<div class="card">

    <div class="header">

        <div class="logo">
            <h1>🚀 Taskify API</h1>
            <p>Fast • Secure • REST API</p>
        </div>

        <div class="status">
            <span class="dot"></span>
            Online
        </div>

    </div>

    <div class="grid">

        <div class="box">
            <h3>Version</h3>
            <p>v1.0.0</p>
        </div>

       <div class="box">
    <h3>Uptime</h3>
   <p id="uptime"></p>
</div>


        <div class="box">
            <h3>Documentation</h3>
            <p>/api</p>
        </div>

    </div>

    <div class="routes">

        <h2>📌 Available Routes</h2>

        <div class="route">
            <span>/auth/register</span>
            <span class="method">POST</span>
        </div>

        <div class="route">
            <span>/auth/login</span>
            <span class="method">POST</span>
        </div>

        <div class="route">
            <span>/task</span>
            <span class="method">GET</span>
        </div>

        <div class="route">
            <span>/health</span>
            <span class="method">GET</span>
        </div>

    </div>

    <div class="buttons">

        <a href="/api" class="btn primary">
            📚 Open Swagger Docs
        </a>

        <a href="/health" class="btn secondary">
            ❤️ Health Check
        </a>

    </div>

    <footer>
        Taskify API • Built with NestJS ⚡
    </footer>

</div>

</body>
<script>
let uptimeSeconds = ${Math.floor(process.uptime())};

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (days > 0) {
        return days + "d " + hours + "h " + minutes + "m " + secs + "s";
    }

    if (hours > 0) {
        return hours + "h " + minutes + "m " + secs + "s";
    }

    if (minutes > 0) {
        return minutes + "m " + secs + "s";
    }

    return secs + "s";
}

function updateUptime() {
    document.getElementById("uptime").textContent =
        formatUptime(uptimeSeconds++);
}

updateUptime();
setInterval(updateUptime, 1000);
</script>
</html>
`;
    }

    private getUptime(): string {
        const diff = Date.now() - this.startedAt.getTime();

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }

        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }

        return `${seconds}s`;
    }
}
