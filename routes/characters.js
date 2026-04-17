const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Get list of available characters with their metadata
router.get('/', (req, res) => {
  try {
    const modelsDir = path.join(__dirname, '..', 'models');

    // Check if models directory exists
    if (!fs.existsSync(modelsDir)) {
      return res.json({ characters: [] });
    }

    // Read character directories
    const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
    const characterDirs = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('ch'))
      .map(entry => entry.name);

    // Build character metadata
    const characters = characterDirs.map(charId => {
      const charDir = path.join(modelsDir, charId);
      const files = fs.readdirSync(charDir);

      // Find base model file
      const baseModelFile = files.find(f =>
        f.toLowerCase().includes('nonpbr') ||
        (f.endsWith('.glb') && !f.toLowerCase().includes('idle') &&
          !f.toLowerCase().includes('walk') && !f.toLowerCase().includes('run'))
      );

      // Find animation files (exclude base model)
      const animationFiles = files.filter(f =>
        f.endsWith('.glb') && f !== baseModelFile
      );

      // Extract character name from ID (e.g., "ch03" -> "Character 03")
      const charNumber = charId.replace('ch', '');
      const charName = `Character ${charNumber}`;

      // Build animations array
      const animations = animationFiles.map(file => {
        const name = file.replace('.glb', '').trim();
        return {
          name: name,
          url: `/models/${charId}/${file}`
        };
      });

      // Sort animations alphabetically
      animations.sort((a, b) => a.name.localeCompare(b.name));

      return {
        id: charId,
        name: charName,
        modelUrl: baseModelFile ? `/models/${charId}/${baseModelFile}` : null,
        thumbnail: `/models/${charId}/thumbnail.jpg`, // Optional, may not exist
        animations: animations
      };
    }).filter(char => char.modelUrl !== null); // Only include characters with a base model

    // Sort characters by ID
    characters.sort((a, b) => a.id.localeCompare(b.id));

    res.json({ characters });
  } catch (error) {
    console.error('Error listing characters:', error);
    res.status(500).json({ error: 'Failed to list characters', message: error.message });
  }
});

module.exports = router;
