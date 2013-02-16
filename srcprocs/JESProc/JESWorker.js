fs = require('fs');
os = require('os');
path = require('path');
uuid = require('node-uuid');
spawn = require('child_process').spawn;
async = require('async');

SrcProcJob = require('../../framework/SrcProcJob.js');

// Strict umask
process.umask(0077)

/**
 * JESWorker Constructor
 * 
 * 
 * 
 * 
 * 
 */
var JESWorker = function(file, username, password)
{
	// Call SrcProcJob's constructor.
	SrcProcJob.call(this);
	
	this.status = SrcProcJob.status.new;
	
	if (file == undefined)
		throw "JES has no file!";
	
	// Generate a unique ID
	this.id = uuid.v1();
	
	// Figure out where we're placing the files.
	this._tmpDir = os.tmpDir()+'/JESWorker';
	
	// _workspace should be a clean folder we can use.
	this._workspace = this._tmpDir+"/"+this.id;
	
	// Get the files situated.
	this.jclFile = file;
	this.jclFilePath = this._workspace+'/'+this.jclFile.path;
	
	// Make sure we have these.
	this._username = username;
	this._password = password;
	this._configFile = this._workspace+'/.JESftp.cfg';
	


	
	this.time = (new Date()).getTime();
	
	
	// outputFiles ought to contain an array of 
	// files generated by the process.
	this.outputFiles = [];
	
	// output will contain what the compilation/execution tells us.
	this.output = '';
	
	
	// Set completion status.
	this.completion = SrcProcJob.completion.incomplete;
	
	
	/* * * * * * * * * * * * * *
	 * PREPARE AND PROCESS JOB *
	 * * * * * * * * * * * * * */
	async.series(
	[
		this._createWorkspace.bind(this),
		this._writeJobFiles.bind(this),
		this._emitReady.bind(this),
		this.start.bind(this)
	]);
	
	
}

// Officially inherit from SrcProcJob
JESWorker.prototype = new SrcProcJob();
JESWorker.prototype.constructor=JESWorker;

//
//
////////////////////////////////////////////////////////////////////////
// Specialized JESWorker methods.
//

/**
 * JESWorker._createWorkspace
 * 
 * Asynchronously ensures that there are folders for this job to work in.
 * This could possibly be promoted to the superclass later.
 * 
 * @param function callback
 * 	A function that should be called when complete.
 * 
 * TODO: handle errors where making these directories fail.
 * TODO: handle error where the tmp directory can't be written to.
 * 
 */
JESWorker.prototype._createWorkspace = function(callback)
{
	var worker = this;
	
	// Do the following asynchronous calls in sequence.
	async.series(
	[
	
		// 1. Does the temporary directory exist?
		function(next)
		{
			
			fs.exists(worker._tmpDir, function(exists)
			{
				// Make the directory if it does not exist.
				if(!exists)
					fs.mkdir(worker._tmpDir, 0700, next)

				else
					next();
				
			});
			
		},
		
		// 2. Make the unique workspace for this job.
		function(next)
		{
			fs.mkdir(worker._workspace, 0700, next);
		}
	
	
	], function(err, results){
		
		err == null || console.log(err);
		
		callback();
	});
	



}


/**
 * JESWorker._writeJobFiles
 * 
 * This writes the required files to the workspace.
 * 
 * 
 * @param function callback
 * 	A function that should be called when complete.
 * 
 */
JESWorker.prototype._writeJobFiles = function(callback)
{
	
	var self = this;


	// Do the following asynchronous calls in sequence.
	async.series(
	[
		function(next)
		{
			// Write the JCL file to the workspace.
			fs.writeFile(self.jclFilePath, self.jclFile.data, "utf8", next)
		},
		
		
		function(next)
		{
			// Write the credentials config to the workspace.
			fs.writeFile(self._configFile, 
			"[JESftp]\nserver = zos.kctr.marist.edu\nusername = "+
			self._username+"\npassword = " + self._password, "utf8", next);
			
		}
	],
		
	function(err, results)
	{		
			callback();
	});
	
	
}



/**
 * JESWorker._emitReady
 * 
 * Sets the status and emits the ready signal.
 * Could be depricated potentially.
 * 
 * @param function callback
 * 	A function that should be called when complete.
 * 
 * @emits SrcProcJob.status.ready
 * 
 */
JESWorker.prototype._emitReady = function(callback)
{
	
	this.status = SrcProcJob.status.ready;
	this.emit(SrcProcJob.status.ready, this);
	
	if (callback != undefined)
		callback();
}



/**
 * JESWorker._destroyWorkspace
 * 
 * Deletes the workspace folder and other cleanup.
 * 
 * 
 */
JESWorker.prototype._destroyWorkspace = function()
{
	
	var self = this;
	
	// Obtain the list of files inside the workspace.
	var files = fs.readdir(this._workspace, function(err, files){
	
		// For each file, delete it.
		for (i in files)
		{
			fs.unlink(self._workspace + '/' + files[i]);
		}
		
		// Remove directory
		fs.rmdir(self._workspace);
		
	});
	
}




/**
 * JESWorker.start
 * 
 * Starts processing the job
 * 
 * @emits SrcProcJob.status.done
 * 
 */
JESWorker.prototype.start = function(callback)
{
	
	var self = this;
	
	this.status = SrcProcJob.status.running;

	
	
	// Obtain the full path to JESftp.py
	var JESftp_py = path.resolve(__dirname, 'JESftp.py');
	console.log(JESftp_py);
	

	
	// Invoke JESftp.py with python
	var	python = spawn('python', [JESftp_py, 
	                              '--config', this._configFile,
	                              this.jclFilePath],
	                               {cwd: this._workspace});
	
	
	
	// Set things up so that we can obtain output from the script...
	// right now it's appending to the output data member of this object.
	python.stdout.setEncoding("utf8");
	python.stdout.on('data', function (data) 
	{
		self.output += data;
	});
	
	python.stderr.on('data', function (data) 
	{
		self.output += data;
	});
	
	
	
	
	
	// Create a listener for when python exits.
	python.on('exit', function(stream)
	{
		
		
		// Obtain the output file
		fs.readFile(self._workspace + '/test-output.txt', "utf8", function(err, outdata)
		{
			
			// Place the data in our json file object.
			self.outputFiles = [{path: 'test-output.txt', type: 'text/plain', data: outdata}];
			
			// Set status codes.
			self.status = SrcProcJob.status.done;
			self.completion = SrcProcJob.completion.success;
			
			// Emit our doneness
			self.emit(SrcProcJob.status.done, this);
			
			// Clean everything up
			self._destroyWorkspace();
			
			// Exit
			callback();
			
			
		});

		
	});
	
}

module.exports = JESWorker;
