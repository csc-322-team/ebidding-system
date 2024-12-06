require('dotenv').config();
const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const systemPrompt = fs.readFileSync('system_prompt.txt', 'utf8');

router.get('/', (req, res) => {
    if (!req.session || !req.session.user) {
        return res.render('redirect', {
            message: 'Access Denied',
            details: 'You must be logged in to access the support page.',
            redirectUrl: '/'
        });
    }
    res.render('support');
});

router.post('/chat', async (req, res) => {
    const API_URL = 'https://api-inference.huggingface.co/models/Qwen/QwQ-32B-Preview';
    const token = process.env.HUGGINGFACE_API_TOKEN;
    const { chatHistory } = req.body;

    try {
        const modelInput = [systemPrompt, ...chatHistory, '//CHAT HISTORY END]\nWrite your response now, starting with an "Assistant:" tag.\n\n'].join('\n\n');

        console.log('Input to model:', modelInput);

        const response = await axios.post(API_URL, {
            inputs: modelInput
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const generatedText = response.data[0]?.generated_text || 'No response received';

        // Extract the last response after the last "Assistant: " delimiter
        const segments = generatedText.replace(/\*/g, '').split('Assistant: ');
        const chatbotResponse = segments.pop() || 'No response received';

        // Further clean up the response to remove any trailing markers
        const cleanedResponse = chatbotResponse.replace(/\/\/.*/, '').trim();

        console.log('Full response from Hugging Face API:', response.data);
        console.log('Extracted and cleaned response from model:', cleanedResponse);

        res.json({ response: cleanedResponse });

    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
});




module.exports = router;
