module.exports = {
    skipFiles: ['test/', 'MultiTroveGetter.sol', 'dependencies/SlotsLib.sol','dependencies/StringLib.sol','dependencies/FixedPointMathLib.sol',],
    mocha: {
        grep: "@skip-on-coverage", // Find everything with this tag
        invert: true               // Run the grep's inverse set.
    }
};