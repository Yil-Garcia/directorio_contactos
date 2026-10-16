/**
 * ============================================================================
 * Directorio de Contactos - API REST con Conexión Nativa a Azure SQL Database
 * ============================================================================
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const sql = require('mssql');
require('dotenv').config();

// ============================================================================
// CONFIGURACIÓN DE CONEXIÓN A AZURE SQL
// ============================================================================
const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  server: process.env.DB_SERVER, // Ej: 'mi-servidor.database.windows.net'
  port: parseInt(process.env.DB_PORT, 10) || 1433,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: true, // Obligatorio para Microsoft Azure SQL Database
    trustServerCertificate: false // Recomendado para producción
  }
};

// Validar que las variables de entorno principales estén definidas
function validarVariables() {
  const faltantes = [];
  if (!process.env.DB_USER) faltantes.push('DB_USER');
  if (!process.env.DB_PASSWORD) faltantes.push('DB_PASSWORD');
  if (!process.env.DB_SERVER) faltantes.push('DB_SERVER');
  if (!process.env.DB_NAME) faltantes.push('DB_NAME');
  return faltantes;
}

// Pool global reutilizable (óptimo para Serverless Functions en Vercel)
let poolPromise = null;
const getPool = async () => {
  const faltantes = validarVariables();
  if (faltantes.length > 0) {
    throw new Error(
      `Faltan variables de entorno requeridas para Azure SQL: ${faltantes.join(', ')}. ` +
      `Configúralas en el archivo .env (local) o en Project Settings > Environment Variables (Vercel).`
    );
  }

  if (!poolPromise) {
    poolPromise = sql.connect(sqlConfig).catch(err => {
      poolPromise = null; // Reiniciar pool en caso de fallo para permitir reintentos
      throw err;
    });
  }
  return poolPromise;
};

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Servir frontend estático en desarrollo local
app.use(express.static(path.join(__dirname, '../public')));

// Router para los endpoints de contactos
const contactosRouter = express.Router();

/**
 * ----------------------------------------------------------------------------
 * 1. GET /api/contactos - Obtener todos los contactos (SELECT)
 * ----------------------------------------------------------------------------
 */
contactosRouter.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query('SELECT Id, Nombre, Email, Telefono FROM Contactos ORDER BY Id DESC');

    // Normalizar nombres de columnas a minúsculas para el frontend
    const contactos = result.recordset.map(row => ({
      id: row.Id,
      nombre: row.Nombre,
      email: row.Email,
      telefono: row.Telefono
    }));

    return res.json(contactos);
  } catch (error) {
    console.error('Error en GET /api/contactos:', error.message);
    return res.status(500).json({
      error: 'Error al consultar contactos en Azure SQL: ' + error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 2. GET /api/contactos/:id - Obtener un contacto por ID (SELECT WHERE)
 * ----------------------------------------------------------------------------
 */
contactosRouter.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'El ID proporcionado no es válido' });
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT Id, Nombre, Email, Telefono FROM Contactos WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: `Contacto con ID #${id} no encontrado` });
    }

    const row = result.recordset[0];
    return res.json({
      id: row.Id,
      nombre: row.Nombre,
      email: row.Email,
      telefono: row.Telefono
    });
  } catch (error) {
    console.error('Error en GET /api/contactos/:id:', error.message);
    return res.status(500).json({
      error: 'Error al consultar el contacto en Azure SQL: ' + error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 3. POST /api/contactos - Crear un nuevo contacto (INSERT)
 * ----------------------------------------------------------------------------
 */
contactosRouter.post('/', async (req, res) => {
  const { nombre, email, telefono } = req.body;

  if (!nombre || !email || !telefono) {
    return res.status(400).json({
      error: 'Todos los campos son requeridos: nombre, email, telefono'
    });
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('nombre', sql.NVarChar(100), nombre.trim())
      .input('email', sql.NVarChar(100), email.trim())
      .input('telefono', sql.NVarChar(20), telefono.trim())
      .query(`
        INSERT INTO Contactos (Nombre, Email, Telefono)
        OUTPUT INSERTED.Id, INSERTED.Nombre, INSERTED.Email, INSERTED.Telefono
        VALUES (@nombre, @email, @telefono)
      `);

    const creado = result.recordset[0];
    return res.status(201).json({
      id: creado.Id,
      nombre: creado.Nombre,
      email: creado.Email,
      telefono: creado.Telefono
    });
  } catch (error) {
    console.error('Error en POST /api/contactos:', error.message);
    return res.status(500).json({
      error: 'Error al insertar contacto en Azure SQL: ' + error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 4. PUT /api/contactos/:id - Actualizar un contacto existente (UPDATE)
 * ----------------------------------------------------------------------------
 */
contactosRouter.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre, email, telefono } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({ error: 'El ID proporcionado no es válido' });
  }

  if (!nombre || !email || !telefono) {
    return res.status(400).json({
      error: 'Todos los campos son requeridos: nombre, email, telefono'
    });
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('nombre', sql.NVarChar(100), nombre.trim())
      .input('email', sql.NVarChar(100), email.trim())
      .input('telefono', sql.NVarChar(20), telefono.trim())
      .query(`
        UPDATE Contactos
        SET Nombre = @nombre, Email = @email, Telefono = @telefono
        OUTPUT INSERTED.Id, INSERTED.Nombre, INSERTED.Email, INSERTED.Telefono
        WHERE Id = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: `Contacto con ID #${id} no encontrado para actualizar` });
    }

    const actualizado = result.recordset[0];
    return res.json({
      id: actualizado.Id,
      nombre: actualizado.Nombre,
      email: actualizado.Email,
      telefono: actualizado.Telefono
    });
  } catch (error) {
    console.error('Error en PUT /api/contactos/:id:', error.message);
    return res.status(500).json({
      error: 'Error al actualizar contacto en Azure SQL: ' + error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 5. DELETE /api/contactos/:id - Eliminar un contacto (DELETE)
 * ----------------------------------------------------------------------------
 */
contactosRouter.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'El ID proporcionado no es válido' });
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM Contactos WHERE Id = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: `Contacto con ID #${id} no encontrado para eliminar` });
    }

    return res.json({
      mensaje: 'Contacto eliminado exitosamente de Azure SQL',
      id
    });
  } catch (error) {
    console.error('Error en DELETE /api/contactos/:id:', error.message);
    return res.status(500).json({
      error: 'Error al eliminar contacto en Azure SQL: ' + error.message
    });
  }
});

// Enrutamiento dual para Vercel y Express local
app.use('/api/contactos', contactosRouter);
app.use('/contactos', contactosRouter);

/**
 * ----------------------------------------------------------------------------
 * Diagnóstico de Conexión: GET /api/health
 * ----------------------------------------------------------------------------
 */
app.get('/api/health', async (req, res) => {
  const faltantes = validarVariables();
  if (faltantes.length > 0) {
    return res.status(500).json({
      status: 'variables_faltantes',
      mensaje: 'Faltan variables de entorno requeridas',
      faltantes,
      pista: 'Asegúrate de configurar estas variables en tu archivo .env o en Vercel.'
    });
  }

  try {
    const pool = await getPool();
    const testResult = await pool.request().query('SELECT 1 AS conectado, GETDATE() AS fechaServidor');
    return res.json({
      status: 'conectado',
      mensaje: 'Conexión a Azure SQL establecida con éxito',
      servidor: process.env.DB_SERVER,
      baseDatos: process.env.DB_NAME,
      fechaServidor: testResult.recordset[0].fechaServidor
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error_conexion',
      mensaje: error.message,
      pista: 'Verifica tus credenciales y asegúrate de permitir tu IP / Servicios de Azure en el Firewall del Portal de Azure.'
    });
  }
});

// Iniciar servidor local si se ejecuta directamente con Node (npm start)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(` Servidor de Contactos corriendo en:`);
    console.log(` Local:       http://localhost:${PORT}`);
    console.log(` API:         http://localhost:${PORT}/api/contactos`);
    console.log(` Diagnóstico: http://localhost:${PORT}/api/health`);
    console.log(` Conexión:    AZURE SQL DATABASE ACTIVA ☁️`);
    console.log(`===================================================`);
  });
}

// Exportar para que Vercel ejecute como Serverless Function
module.exports = app;
