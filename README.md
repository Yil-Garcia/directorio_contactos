# 📱 Directorio de Contactos | Integración con Azure SQL Database en Vercel

Aplicación web Full-Stack diseñada como plantilla y laboratorio práctico para estudiantes de ingeniería, enfocada en la **integración de bases de datos relacionales en la nube (Azure SQL Database)** consumidas desde una arquitectura serverless en **Vercel**.

---

## ☁️ Azure SQL Database vs. SQL Server Tradicional (On-Premises / Local)

Comprender la diferencia entre una base de datos local y una en la nube es fundamental en la ingeniería de software moderna:

| Característica | SQL Server Tradicional (Local / On-Premises) | Azure SQL Database (PaaS en la Nube) |
|---|---|---|
| **Alojamiento** | Servidor físico, contenedor Docker o máquina virtual local. | **Platform as a Service (PaaS)** totalmente administrado por Microsoft. |
| **Dirección de Red** | `localhost`, `127.0.0.1` o una IP privada dentro de una red de área local (LAN). | **Dominio público con Gateway:** `tu-servidor.database.windows.net` en el puerto `1433`. |
| **Cifrado en Tránsito (TLS)** | Opcional y habitualmente desactivado en entornos de desarrollo (`encrypt: false`). | **Estrictamente Obligatorio (`encrypt: true`)**. Azure rechaza conexiones no cifradas por protocolo TLS 1.2+. |
| **Validación de Certificados** | Frecuentemente se confía en certificados autofirmados (`trustServerCertificate: true`). | Valida contra las autoridades certificadoras de Microsoft (`trustServerCertificate: false`). |
| **Seguridad de Red (Firewall)** | Controlado por el firewall del sistema operativo o del router local. | **Firewall perimetral a nivel de servidor de Azure**. Requiere autorizar IPs específicas y habilitar la opción de acceso para servicios de Azure. |
| **Tipo de Instancia** | Instancia completa con acceso a base de datos `master`, jobs de SQL Server Agent y filesystem local. | Base de datos lógica aislada (*Single Database* o *Elastic Pool*) con alta disponibilidad y respaldos automáticos incluidos. |
| **Modelo de Conexiones** | Servidores continuos con conexiones de larga duración y persistentes. | **Entornos Serverless:** Conexiones efímeras donde es vital reutilizar el *Connection Pool* para no saturar los límites de conexión. |

---

## 🔑 Anatomía de la Cadena de Conexión (Connection String)

La **Cadena de Conexión** es la clave de acceso que contiene los parámetros criptográficos, de red y de autenticación que el cliente (`mssql` / `tedious`) utiliza para establecer el túnel seguro hacia Azure.

### 1. Formato estándar T-SQL / ADO.NET
```text
Server=tcp:mi-servidor.database.windows.net,1433;Initial Catalog=DirContacts;Persist Security Info=False;User ID=adminUser;Password=MiPasswordSeguro123!;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

### 2. Desglose detallado de los parámetros:

1. **`Server=tcp:mi-servidor.database.windows.net,1433` (`DB_SERVER`)**:
   - `tcp:`: Especifica el protocolo de red de transporte (TCP/IP).
   - `mi-servidor.database.windows.net`: Es el nombre completo de dominio (FQDN) del servidor lógico de Azure SQL.
   - `,1433`: Puerto estándar internacional para Microsoft SQL Server.
2. **`Initial Catalog=DirContacts` (`DB_NAME`)**:
   - Nombre de la base de datos específica dentro del servidor a la que se desea conectar directamente tras autenticarse.
3. **`User ID=adminUser` (`DB_USER`)**:
   - Nombre de usuario con permisos de lectura/escritura (`db_datareader`, `db_datawriter` o administrador) en la base de datos.
4. **`Password=MiPasswordSeguro123!` (`DB_PASSWORD`)**:
   - Contraseña de autenticación de SQL Server.
5. **`Encrypt=True` (`options.encrypt: true`)**:
   - **Requisito obligatorio de Azure:** Exige que la sesión de red esté cifrada mediante certificados SSL/TLS.
6. **`TrustServerCertificate=False` (`options.trustServerCertificate: false`)**:
   - Impide ataques de intermediario (*Man-in-the-Middle*), validando que el certificado provenga de una entidad certificadora legítima de Microsoft.
7. **`Connection Timeout=30`**:
   - Segundos de espera máxima para establecer la conexión antes de abortar en caso de latencia de red o bloqueo por firewall.

---

## 🛠️ Cómo se traduce la Cadena de Conexión en Node.js (`mssql`)

En lugar de concatenar un string largo y propenso a errores, el controlador nativo de Node.js utiliza un objeto estructurado basado en las **Variables de Entorno**:

```javascript
const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  server: process.env.DB_SERVER, // ej. 'mi-servidor.database.windows.net'
  port: parseInt(process.env.DB_PORT, 10) || 1433,
  pool: {
    max: 10,                 // Límite máximo de conexiones concurrentes en el pool
    min: 0,                  // Mínimo de conexiones inactivas
    idleTimeoutMillis: 30000 // Tiempo antes de liberar una conexión inactiva
  },
  options: {
    encrypt: true,           // Obligatorio para Azure SQL
    trustServerCertificate: false
  }
};
```

### Gestión del Connection Pool en Arquitectura Serverless (Vercel)
En funciones serverless, cada invocación puede ejecutarse en un contenedor en la nube. Para evitar abrir y cerrar conexiones a cada segundo (lo que agotaría las conexiones en Azure SQL), se utiliza un **Pool Singleton Global**:

```javascript
let poolPromise = null;

const getPool = async () => {
  if (!poolPromise) {
    poolPromise = sql.connect(sqlConfig).catch(err => {
      poolPromise = null; // Reiniciar en caso de error para reintentos limpios
      throw err;
    });
  }
  return poolPromise;
};
```

---

## 🚀 Guía de Integración Paso a Paso (Azure SQL + Vercel)

### Paso 1: Configurar el Servidor y la Base de Datos en Azure Portal
1. Inicia sesión en [portal.azure.com](https://portal.azure.com).
2. Crea una **Azure SQL Database** (por ejemplo, `DirContacts`).
3. En la pestaña de configuración del recurso **SQL Server** > **Seguridad** > **Redes (Networking)**:
   - **Acceso público:** Configurado en *Redes seleccionadas* o *Todas las redes*.
   - **Excepciones de Firewall:** Marca obligatoriamente la casilla:
     > **"Permitir que los servicios y recursos de Azure accedan a este servidor"** (*Allow Azure services and resources to access this server*).
   - *(Opcional)* Agrega la IP pública de tu red para conectarte desde herramientas externas (SSMS o Azure Data Studio).

---

### Paso 2: Crear la tabla `Contactos` (Script DDL Transact-SQL)
Ejecuta este script en el **Editor de consultas (Query editor)** de Azure Portal o mediante Azure Data Studio:

```sql
-- ============================================================================
-- SCRIPT DDL: CREACIÓN DE LA TABLA "Contactos" EN AZURE SQL
-- ============================================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Contactos')
BEGIN
    CREATE TABLE Contactos (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Nombre NVARCHAR(100) NOT NULL,
        Email NVARCHAR(100) NOT NULL,
        Telefono NVARCHAR(20) NOT NULL,
        FechaRegistro DATETIME DEFAULT GETDATE()
    );
    PRINT 'Tabla Contactos creada con éxito.';
END
GO

-- Registros semilla de prueba inicial:
INSERT INTO Contactos (Nombre, Email, Telefono)
VALUES 
    (N'Ana García', N'ana.garcia@universidad.edu', N'+52 55 1234 5678'),
    (N'Carlos Mendoza', N'carlos.mendoza@universidad.edu', N'+52 55 8765 4321'),
    (N'Lucía Fernández', N'lucia.f@universidad.edu', N'+52 55 5555 1234');
GO

-- Comprobación:
SELECT Id, Nombre, Email, Telefono FROM Contactos ORDER BY Id DESC;
GO
```

---

### Paso 3: Configurar Variables de Entorno en Vercel
En la nube, las credenciales nunca deben estar escritas en el código (*hardcoded*). Se inyectan de forma segura a través del panel de Vercel:

1. Entra a tu proyecto en [vercel.com](https://vercel.com) > pestaña **Settings** > **Environment Variables**.
2. Añade las 4 variables de conexión:

| Variable | Valor de Ejemplo | Descripción |
|---|---|---|
| `DB_SERVER` | `tu-servidor.database.windows.net` | Nombre del servidor SQL en Azure |
| `DB_NAME` | `DirContacts` | Nombre de la base de datos creada |
| `DB_USER` | `adminUser` | Usuario administrador de SQL Server |
| `DB_PASSWORD` | `TuContraseñaSegura123!` | Contraseña configurada en Azure |

3. Ve a la pestaña **Deployments** en Vercel, pulsa en los tres puntos `...` de tu último despliegue y selecciona **Redeploy** para aplicar las variables.

---

### Paso 4: Seguridad y Consultas T-SQL Parametrizadas
En el backend ([`api/index.js`](api/index.js)), todas las operaciones se ejecutan mediante consultas T-SQL nativas utilizando **parámetros tipados (`.input`)** para garantizar protección absoluta contra **Inyección SQL (SQLi)**:

```javascript
// Ejemplo: Inserción segura con retorno del ID generado
const result = await pool.request()
  .input('nombre', sql.NVarChar(100), nombre.trim())
  .input('email', sql.NVarChar(100), email.trim())
  .input('telefono', sql.NVarChar(20), telefono.trim())
  .query(`
    INSERT INTO Contactos (Nombre, Email, Telefono)
    OUTPUT INSERTED.Id, INSERTED.Nombre, INSERTED.Email, INSERTED.Telefono
    VALUES (@nombre, @email, @telefono)
  `);
```

---

## 📡 Referencia de la API REST

| Método | Endpoint | Descripción | Consulta T-SQL Ejecutada |
|---|---|---|---|
| `GET` | `/api/contactos` | Lista todos los contactos | `SELECT Id, Nombre, Email, Telefono FROM Contactos ORDER BY Id DESC` |
| `GET` | `/api/contactos/:id` | Obtiene un contacto por ID | `SELECT ... FROM Contactos WHERE Id = @id` |
| `POST` | `/api/contactos` | Registra un nuevo contacto | `INSERT INTO Contactos ... OUTPUT INSERTED.* VALUES (@nombre, @email, @telefono)` |
| `PUT` | `/api/contactos/:id` | Modifica un contacto existente | `UPDATE Contactos SET ... OUTPUT INSERTED.* WHERE Id = @id` |
| `DELETE` | `/api/contactos/:id` | Elimina un contacto por ID | `DELETE FROM Contactos WHERE Id = @id` |
| `GET` | `/api/health` | Diagnóstico de salud | Prueba de conexión: `SELECT 1 AS conectado, GETDATE() AS fechaServidor` |

---

## 🩺 Diagnóstico y Verificación de Conexión

Puedes comprobar en cualquier momento si Vercel tiene conectividad directa con Azure SQL visitando el endpoint de salud de tu proyecto en el navegador:

```text
https://tu-proyecto.vercel.app/api/health
```

**Respuesta esperada cuando la conexión es exitosa:**
```json
{
  "status": "conectado",
  "mensaje": "Conexión a Azure SQL establecida con éxito",
  "servidor": "tu-servidor.database.windows.net",
  "baseDatos": "DirContacts",
  "fechaServidor": "2026-10-10T07:25:00.000Z"
}
```
