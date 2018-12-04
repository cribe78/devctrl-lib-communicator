The @devctrl/lib-communicator package includes files used for implementing Devctrl communicators.  A devctrl 
communicator is a process which handles communications between the devctrl server and a device ("endpoint").  

The @devctrl/communicator package contains the communicator program, which manages communication with the server.  The 
communicator for a specific endpoint will attempt to load a communicator class which defines the specifics of the 
protocol for controlling the endpoint.  A communicator class must implement the IEndpointCommunicator interface 
defined in EndpointCommunicator.ts and will usually extend one of the IEndpointCommunicator implementations provided in 
this package.  These implementations are: 

| Class           | Use case  |
| TCPCommunicator | for devices that communicate via a TCP socket (e.g. telnet)  |
| SynchronousTCPCommunicator | TCP devices that process only a single command at a time | 
| HTTPCommunicator | for devices that communicate via HTTP requests |
| JSONRPCCommunicator | for devices that pass JSON-RPC objects over TCP streams |
| EndpointCommunicator  |  for other devices, contains common implementation details |   
| DummyCommunicator | used for testing, doesn't not connect to a device and simply echoes expected responses to server |

This is a summary of the communicator instance life cycle: 

 * Communicator is instantiated with an IEndpointCommunicatorConfig object
 * A list of controls provided by getControlTemplates() is synced with the existing controls defined on the server.  Any
 newly defined controls are created on the server.  Each control template has a unique identifier, CTID, which includes
 the endpoint id.   
 * The setTemplates() function is called with control objects defined on the server.  This allows control instances 
 to be persisted across restarts of the communicator.  The communicator class will typically maintain some control data 
 that is not persisted on the server, such as the line level protocol details needed for performing actions associated 
 with the control
 * The endpoint connection is started with a call to run()       
 * The communicator class calls the statusUpdateCallback function provided in the IEndpointCommunicatorConfig to notify
 the server of endpoint status changes
 * The communicator host process calls updateStatus() to notify the communicator class of endpoint status changes. 
 Specifically, enabled status property is determined server side.      
 * The communicator class calls the controlUpdateCallback function to notify the server of control value changes
 * The communicator host process call handleControlUpdateRequest() when control changes are requested.  The communicator 
 class then sends the appropriate commands to the endpoint
 * When the communicator host process calls reset(), the communicator class should reconnect to the endpoint.  This may
  happen if the IP/Port or other connection details have changed for the endpoint. 


 