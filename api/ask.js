/**
 * DOCUMENTATION HUB - BACKEND SERVERLESS
 * Para Vercel
 * 
 * Coloca este archivo en: /api/ask.js
 */

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Maneja OPTIONS
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Solo POST
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            error: 'Método no permitido',
            code: 'METHOD_NOT_ALLOWED'
        });
    }

    try {
        const { apiKey, question, documents } = req.body;

        // Validar inputs
        if (!apiKey || !question || !Array.isArray(documents)) {
            return res.status(400).json({
                error: 'Parámetros inválidos. Requiere: apiKey, question, documents',
                code: 'INVALID_INPUT'
            });
        }

        // Validar API key
        if (typeof apiKey !== 'string' || !apiKey.startsWith('sk-ant-') || apiKey.length < 20) {
            return res.status(401).json({
                error: 'API key inválida',
                code: 'INVALID_API_KEY'
            });
        }

        // Validar pregunta
        const sanitizedQuestion = String(question).trim();
        if (sanitizedQuestion.length < 3) {
            return res.status(400).json({
                error: 'La pregunta es muy corta (mínimo 3 caracteres)',
                code: 'QUESTION_TOO_SHORT'
            });
        }

        // Construir contexto de documentos
        let documentContext = '';
        try {
            documentContext = documents
                .map(doc => {
                    const docName = String(doc.name || 'documento').substring(0, 200);
                    const docContent = String(doc.content || '').substring(0, 3000);
                    return `[${docName}]\n${docContent}`;
                })
                .join('\n\n---\n\n');
        } catch (e) {
            return res.status(400).json({
                error: 'Error al procesar documentos',
                code: 'INVALID_DOCUMENTS'
            });
        }

        if (!documentContext.trim()) {
            return res.status(400).json({
                error: 'No hay documentos válidos',
                code: 'NO_VALID_DOCUMENTS'
            });
        }

        // System prompt
        const systemPrompt = `Eres un asistente inteligente para documentación empresarial.
Responde basándote ÚNICAMENTE en los documentos proporcionados.

INSTRUCCIONES:
1. Si encuentras la respuesta, cítala claramente
2. Si no hay información, di "No encontré información sobre esto en los documentos"
3. Sé conciso pero completo
4. Usa listas y párrafos para claridad
5. Mantén el mismo idioma de la pregunta
6. NUNCA inventes información`;

        // Mensaje del usuario
        const userMessage = `DOCUMENTOS:\n\n${documentContext}\n\nPREGUNTA: ${sanitizedQuestion}`;

        // Llamar a Claude API
        console.log('Enviando request a Claude API...');
        
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
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

        console.log('Response status:', anthropicResponse.status);

        if (!anthropicResponse.ok) {
            const errorData = await anthropicResponse.json();
            console.error('Anthropic error:', errorData);

            if (anthropicResponse.status === 401) {
                return res.status(401).json({
                    error: 'API key inválida o expirada',
                    code: 'INVALID_API_KEY'
                });
            }

            if (anthropicResponse.status === 429) {
                return res.status(429).json({
                    error: 'Límite de rate de Anthropic excedido. Intenta en unos segundos.',
                    code: 'ANTHROPIC_RATE_LIMIT'
                });
            }

            if (anthropicResponse.status >= 500) {
                return res.status(503).json({
                    error: 'Servidor de Anthropic no disponible. Intenta más tarde.',
                    code: 'ANTHROPIC_SERVER_ERROR'
                });
            }

            return res.status(anthropicResponse.status).json({
                error: errorData.error?.message || 'Error en Claude API',
                code: 'ANTHROPIC_ERROR'
            });
        }

        const data = await anthropicResponse.json();
        console.log('Success response from Anthropic');

        if (!data.content || !data.content[0]) {
            return res.status(500).json({
                error: 'Respuesta inválida de Claude API',
                code: 'INVALID_RESPONSE'
            });
        }

        return res.status(200).json({
            success: true,
            response: data.content[0].text,
            usage: {
                input_tokens: data.usage?.input_tokens || 0,
                output_tokens: data.usage?.output_tokens || 0
            }
        });

    } catch (error) {
        console.error('Unhandled error:', error);

        // Detectar tipo de error
        let errorCode = 'INTERNAL_ERROR';
        let errorMsg = 'Error interno del servidor';

        if (error.message.includes('fetch') || error.message.includes('network')) {
            errorCode = 'NETWORK_ERROR';
            errorMsg = 'Error de conectividad con Claude API';
        } else if (error.message.includes('JSON')) {
            errorCode = 'JSON_ERROR';
            errorMsg = 'Error al procesar JSON';
        } else if (error.message.includes('timeout')) {
            errorCode = 'TIMEOUT_ERROR';
            errorMsg = 'Timeout al conectar con Claude API';
        }

        return res.status(500).json({
            error: errorMsg,
            code: errorCode,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
