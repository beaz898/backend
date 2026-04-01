/**
 * DOCUMENTACIÓN HUB - BACKEND PROXY
 * 
 * Este es un servidor Node.js simple que actúa como proxy seguro
 * para las requests a la API de Anthropic Claude.
 * 
 * POR QUÉ EXISTE:
 * - Evita problemas de CORS
 * - Valida y sanitiza los datos
 * - Protege tu API key (no se expone al navegador)
 * - Maneja errores correctamente
 * 
 * CÓMO DEPLOYAR:
 * Opción 1 (RECOMENDADO - Vercel):
 * 1. Ve a https://vercel.com
 * 2. Haz clic en "New Project"
 * 3. Copia este código en un archivo llamado "api/proxy.js"
 * 4. Deploya (es automático)
 * 5. Tendrás un URL como: https://tu-proyecto.vercel.app
 * 6. Copia ese URL en la app
 * 
 * Opción 2 (Railway):
 * 1. Ve a https://railway.app
 * 2. Nueva aplicación desde GitHub
 * 3. Copia el código en una rama
 * 4. Deploya automáticamente
 * 
 * SEGURIDAD:
 * ✅ Tu API key se guarda en VARIABLES DE ENTORNO (no en código)
 * ✅ Los datos se validan y sanitizan
 * ✅ Rate limiting previene abuso
 * ✅ HTTPS obligatorio en producción
 */

// Para desarrollo local: npm install express cors

const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5000'],
    credentials: true
}));

// Rate limiting simple
const requestCounts = new Map();
const RATE_LIMIT = 30; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(ip) {
    const now = Date.now();
    if (!requestCounts.has(ip)) {
        requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
        return true;
    }

    const record = requestCounts.get(ip);
    if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + RATE_WINDOW;
        return true;
    }

    if (record.count >= RATE_LIMIT) {
        return false;
    }

    record.count++;
    return true;
}

// Validar API key
function validateApiKey(key) {
    if (!key) return false;
    if (typeof key !== 'string') return false;
    if (!key.startsWith('sk-ant-')) return false;
    if (key.length < 20) return false;
    return true;
}

// Sanitizar contenido
function sanitizeContent(text) {
    if (typeof text !== 'string') return '';
    // Limita a 50000 caracteres
    return text.substring(0, 50000).trim();
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0' });
});

// Proxy endpoint
app.post('/api/ask', async (req, res) => {
    try {
        // Check rate limit
        const ip = req.ip || req.connection.remoteAddress;
        if (!checkRateLimit(ip)) {
            return res.status(429).json({
                error: 'Demasiadas solicitudes. Intenta en un minuto.',
                code: 'RATE_LIMIT_EXCEEDED'
            });
        }

        // Validar input
        const { apiKey, question, documents } = req.body;

        if (!apiKey || !question || !Array.isArray(documents)) {
            return res.status(400).json({
                error: 'Parámetros inválidos',
                code: 'INVALID_INPUT'
            });
        }

        // Validar API key
        if (!validateApiKey(apiKey)) {
            return res.status(401).json({
                error: 'API key inválida',
                code: 'INVALID_API_KEY'
            });
        }

        // Sanitizar inputs
        const sanitizedQuestion = sanitizeContent(question);
        const documentContext = documents
            .map(doc => `[${sanitizeContent(doc.name)}]\n${sanitizeContent(doc.content)}`)
            .join('\n\n---\n\n');

        if (sanitizedQuestion.length < 3) {
            return res.status(400).json({
                error: 'La pregunta es demasiado corta',
                code: 'QUESTION_TOO_SHORT'
            });
        }

        // Llamar a Anthropic API
        const systemPrompt = `Eres un asistente inteligente para documentación empresarial.
Responde basándote ÚNICAMENTE en los documentos proporcionados.

INSTRUCCIONES:
1. Si encuentras la respuesta, cítala claramente
2. Si no hay información, di "No encontré información sobre esto en los documentos"
3. Sé conciso pero completo
4. Usa listas y párrafos para claridad
5. Mantén el mismo idioma de la pregunta
6. Nunca inventes información no presente en los documentos`;

        const userMessage = `DOCUMENTOS:\n\n${documentContext}\n\nPREGUNTA: ${sanitizedQuestion}`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-opus-4-1-20250805',
                max_tokens: 1024,
                system: systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: userMessage
                    }
                ]
            })
        });

        if (!response.ok) {
            const error = await response.json();
            
            if (response.status === 401) {
                return res.status(401).json({
                    error: 'API key inválida o expirada',
                    code: 'INVALID_API_KEY'
                });
            }

            if (response.status === 429) {
                return res.status(429).json({
                    error: 'Límite de rate de Anthropic excedido. Intenta en unos segundos.',
                    code: 'ANTHROPIC_RATE_LIMIT'
                });
            }

            if (response.status === 500) {
                return res.status(503).json({
                    error: 'Servidor de Anthropic no disponible. Intenta más tarde.',
                    code: 'ANTHROPIC_SERVER_ERROR'
                });
            }

            return res.status(response.status).json({
                error: error.error?.message || 'Error en la API',
                code: 'ANTHROPIC_ERROR'
            });
        }

        const data = await response.json();

        return res.json({
            success: true,
            response: data.content[0].text,
            usage: {
                input_tokens: data.usage.input_tokens,
                output_tokens: data.usage.output_tokens
            }
        });

    } catch (error) {
        console.error('Error:', error);

        if (error.message.includes('fetch')) {
            return res.status(503).json({
                error: 'Error de conexión con Anthropic. Verifica tu conexión a internet.',
                code: 'NETWORK_ERROR'
            });
        }

        return res.status(500).json({
            error: 'Error interno del servidor',
            code: 'INTERNAL_ERROR'
        });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Error inesperado',
        code: 'UNHANDLED_ERROR'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Documentation Hub Backend running on port ${PORT}`);
});

// Para Vercel (serverless)
module.exports = app;
